chrome.runtime.onMessage.addListener(async (request, sender, sendResponse) => {
  if (request.action === "sendChatMessage") {
    try {
      const apiKey = await getApiKey();
      if (!apiKey) throw new Error('API ключ не найден. Сохраните ключ в настройках.');
      const result = await chrome.storage.local.get(['chatHistory']);
      let chatHistory = result.chatHistory || [];
      const lastUserMsg = request.history.filter(m => m.role === 'user').slice(-1)[0];
      if (lastUserMsg && (!chatHistory.length || chatHistory[chatHistory.length-1].content !== lastUserMsg.content || chatHistory[chatHistory.length-1].role !== 'user')) {
        chatHistory.push(lastUserMsg);
      }
      const messages = [
        { role: 'system', content: 'Ты - полезный AI помощник для проверки фактов и анализа новостей. Отвечай точно и информативно.' },
        ...chatHistory.slice(-10)
      ];
      const response = await fetch('https://api.deepseek.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model: 'deepseek-chat',
          messages: messages,
          max_tokens: 1000,
          temperature: 0.7
        })
      });
      if (!response.ok) throw new Error('Ошибка API: ' + response.status);
      const data = await response.json();
      const botMessage = data.choices[0].message.content;
      chatHistory.push({ role: 'assistant', content: botMessage });
      if (chatHistory.length > 50) chatHistory = chatHistory.slice(-25);
      await chrome.storage.local.set({ chatHistory });
      chrome.notifications.create('chat_' + Date.now(), {
        type: 'basic',
        iconUrl: 'pictures/icon48.png',
        title: 'VacLive - Ответ в чате',
        message: botMessage.length > 100 ? 'Ответ получен' : botMessage,
        priority: 1
      });
      sendResponse({ success: true });
    } catch (error) {
      sendResponse({ success: false, error: error.message });
    }
    return true;
  }
});

chrome.notifications.onClicked.addListener(async (notificationId) => {
  if (notificationId.startsWith('chat_')) {
    chrome.action.openPopup();
    chrome.notifications.clear(notificationId);
  }
});

async function getApiKey() {
  const result = await chrome.storage.local.get(['deepseekApiKey']);
  return result.deepseekApiKey;
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: "analyse-selection",
    title: "Анализировать выделенный текст",
    contexts: ["selection"]
  });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === "analyse-selection" && info.selectionText) {
      chrome.storage.local.set({ analysedText: info.selectionText }, () => {
          chrome.action.openPopup();
      });
  }
});

let activeAnalyses = new Map();

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "startAnalysis") {
      const analysisId = request.analysisId || 'analysis_' + Date.now();
      
      sendResponse({ success: true, message: "Анализ запущен", analysisId: analysisId });
      
      const controller = new AbortController();
      
      activeAnalyses.set(analysisId, {
          status: 'processing',
          startTime: Date.now(),
          text: request.text.substring(0, 100),
          title: request.title,
          progress: 0,
          message: 'Запуск анализа...',
          controller: controller,
          signal: controller.signal
      });
      
      startBackgroundAnalysis(request.text, request.title, analysisId, controller.signal)
          .then(result => {
              if (controller.signal.aborted) {
                  console.log('Анализ был отменен:', analysisId);
                  return;
              }
              
              chrome.runtime.sendMessage({
                  action: "analysisComplete",
                  result: result,
                  analysisId: analysisId
              }).catch(error => console.log('Popup закрыт, результат не отправлен'));
              
              showAnalysisNotification(analysisId, result.verdict);
              
              chrome.storage.local.set({ lastAnalysisResult: result });
              
              activeAnalyses.delete(analysisId);
          })
          .catch(error => {
              if (controller.signal.aborted) {
                  console.log('Анализ отменен:', analysisId);
                  return;
              }
              
              console.error('Ошибка анализа:', error);
              chrome.runtime.sendMessage({
                  action: "analysisError",
                  error: error.message,
                  analysisId: analysisId
              }).catch(error => console.log('Popup закрыт, ошибка не отправлена'));
              
              activeAnalyses.delete(analysisId);
          });
      
      return true;
  }
  
  if (request.action === "getAnalysisStatus") {
      const analysis = activeAnalyses.get(request.analysisId);
      sendResponse({ 
          status: analysis ? analysis.status : 'not_found',
          analysis: analysis || null 
      });
      return true;
  }

  if (request.action === "cancelAnalysis") {
      const analysis = activeAnalyses.get(request.analysisId);
      if (analysis) {
          if (analysis.controller) {
              analysis.controller.abort();
              console.log('Анализ отменен:', request.analysisId);
          }
          
          activeAnalyses.delete(request.analysisId);
          
          sendResponse({ success: true, message: "Анализ отменен" });
      } else {
          sendResponse({ success: false, error: "Анализ не найден" });
      }
      return true;
  }
});

async function startBackgroundAnalysis(text, title, analysisId, signal) {
  console.log('Запуск анализа:', { analysisId, textLength: text.length });
  
  if (signal.aborted) {
      throw new Error('Анализ отменен');
  }
  
  try {
      await sendProgress(analysisId, 'Подготовка анализа...', 10);
      
      const apiKey = await getApiKey();
      if (!apiKey) {
          throw new Error('API ключ не найден. Сохраните ключ в настройках.');
      }
      
      if (signal.aborted) {
          throw new Error('Анализ отменен');
      }
      
      await sendProgress(analysisId, 'Проверка API ключа...', 20);
      
      const prompt = `Проанализируй этот текст новости и дай оценку достоверности. ОБЯЗАТЕЛЬНО указывай конкретные источники для каждого факта. Ответь ТОЛЬКО в формате JSON:

{
  "verdict": "Правдивые|Недостоверные|Частично правдивые",
  "confidence_level": "высокий|средний|низкий",
  "summary": "краткое описание",
  "fact_check": {
    "verified_facts": [
      {
        "fact": "конкретный проверенный факт",
        "source": "конкретный источник (URL или название)"
      }
    ],
    "false_claims": [
      {
        "claim": "ложное утверждение",
        "contradiction_source": "источник опровержения"
      }
    ],
    "unverified_claims": [
      {
        "claim": "непроверенное утверждение",
        "reason": "причина непроверенности"
      }
    ]
  },
  "sources_validation": {
    "working_sources": 0,
    "broken_sources": 0,
    "official_sources_count": 0,
    "cross_verification_score": 0
  },
  "recommendations": []
}

ВАЖНЫЕ ТРЕБОВАНИЯ:
1. Для КАЖДОГО проверенного факта указывай конкретный источник (URL, официальный документ, авторитетное издание)
2. Для ложных утверждений указывай источник опровержения
3. Если источник неизвестен, пиши "Источник не указан в тексте"
4. Не используй общие фразы, только конкретные данные

Текст для анализа: ${text.substring(0, 4000)}`;
      
      if (signal.aborted) {
          throw new Error('Анализ отменен');
      }
      
      await sendProgress(analysisId, 'Отправка запроса к AI...', 40);
      
      console.log('Отправка запроса к API...');
      
      const timeoutPromise = new Promise((_, reject) => {
          setTimeout(() => reject(new Error('Таймаут запроса')), 30000);
      });
      
      const fetchPromise = fetch('https://api.deepseek.com/v1/chat/completions', {
          method: 'POST',
          headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${apiKey}`
          },
          body: JSON.stringify({
              model: 'deepseek-chat',
              messages: [{ role: 'user', content: prompt }],
              max_tokens: 2000,
              temperature: 0.3
          }),
          signal: signal
      });
      
      const response = await Promise.race([fetchPromise, timeoutPromise]);
      
      console.log('Получен ответ от API:', response.status);
      
      if (!response.ok) {
          const errorText = await response.text();
          console.error('Ошибка API:', response.status, errorText);
          throw new Error(`Ошибка API: ${response.status}`);
      }
      
      if (signal.aborted) {
          throw new Error('Анализ отменен');
      }
      
      await sendProgress(analysisId, 'Обработка результатов...', 80);
      
      const data = await response.json();
      console.log('Данные ответа:', data);
      
      if (!data.choices || !data.choices[0]) {
          throw new Error('Неверный формат ответа от API');
      }
      
      if (signal.aborted) {
          throw new Error('Анализ отменен');
      }
      
      const result = parseAnalysisResult(data.choices[0].message.content);
      console.log('Результат анализа:', result);
      
      await sendProgress(analysisId, 'Завершение анализа...', 100);
      
      await saveAnalysisToHistory({
          title: title,
          text: text,
          result: result
      });
      
      return result;
      
  } catch (error) {
      if (error.name === 'AbortError' || error.message === 'Анализ отменен') {
          console.log('Анализ отменен пользователем:', analysisId);
          throw error;
      }
      
      console.error('Ошибка в анализе:', error);
      throw error;
  }
}

async function sendProgress(analysisId, message, progress) {
  const analysis = activeAnalyses.get(analysisId);
  if (!analysis) {
      console.log('Анализ не найден, пропускаем прогресс:', analysisId);
      return;
  }
  
  console.log(`Прогресс [${analysisId}]: ${message} (${progress}%)`);
  
  analysis.progress = progress;
  analysis.message = message;
  activeAnalyses.set(analysisId, analysis);
  
  try {
      await chrome.runtime.sendMessage({
          action: "analysisProgress",
          analysisId: analysisId,
          message: message,
          progress: progress
      });
  } catch (error) {
      console.log('Прогресс не отправлен (popup закрыт)');
  }
}

async function getApiKey() {
  const result = await chrome.storage.local.get(['deepseekApiKey']);
  return result.deepseekApiKey;
}

function parseAnalysisResult(result) {
  console.log('Парсинг результата:', result);
  
  try {
    const jsonMatch = result.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      console.log('Успешно распарсен JSON:', parsed);
      
      return enhanceAnalysisResult(parsed);
    }
    
    console.log('JSON не найден, создаем базовый ответ');
    return {
      verdict: "Частично правдивые",
      confidence_level: "средний",
      fact_check: {
        verified_facts: [{ 
          fact: "Базовый анализ выполнен", 
          source: "Системный анализ - источники требуют ручной проверки" 
        }],
        false_claims: [],
        unverified_claims: []
      },
      sources_validation: {
        working_sources: 1,
        broken_sources: 0,
        official_sources_count: 0,
        cross_verification_score: 5
      },
      summary: "Анализ выполнен. " + (result.substring(0, 200) || "Результат получен. Рекомендуется проверить источники вручную."),
      recommendations: ["Проверьте дополнительные источники для уверенности", "Убедитесь в наличии конкретных ссылок на источники"]
    };
    
  } catch (error) {
    console.error('Ошибка парсинга:', error);
    return {
      verdict: "Не удалось проанализировать",
      confidence_level: "низкий",
      fact_check: {
        verified_facts: [],
        false_claims: [],
        unverified_claims: []
      },
      sources_validation: {
        working_sources: 0,
        broken_sources: 0,
        official_sources_count: 0,
        cross_verification_score: 0
      },
      summary: "Произошла ошибка при анализе текста: " + error.message,
      recommendations: ["Попробуйте проанализировать другой текст", "Проверьте API ключ"]
    };
  }
}

function enhanceAnalysisResult(result) {
  if (result.fact_check && result.fact_check.verified_facts) {
    result.fact_check.verified_facts = result.fact_check.verified_facts.map((fact, index) => {
      if (typeof fact === 'string') {
        return {
          fact: fact,
          source: "Источник не указан в анализе"
        };
      }
      return {
        fact: fact.fact || `Факт ${index + 1}`,
        source: fact.source || "Источник не указан"
      };
    });
  }
  
  if (result.fact_check && result.fact_check.false_claims) {
    result.fact_check.false_claims = result.fact_check.false_claims.map((claim, index) => {
      if (typeof claim === 'string') {
        return {
          claim: claim,
          contradiction_source: "Источник опровержения не указан"
        };
      }
      return {
        claim: claim.claim || `Ложное утверждение ${index + 1}`,
        contradiction_source: claim.contradiction_source || "Источник опровержения не указан"
      };
    });
  }
  
  if (result.fact_check && result.fact_check.unverified_claims) {
    result.fact_check.unverified_claims = result.fact_check.unverified_claims.map((claim, index) => {
      if (typeof claim === 'string') {
        return {
          claim: claim,
          reason: "Причина непроверенности не указана"
        };
      }
      return {
        claim: claim.claim || `Утверждение ${index + 1}`,
        reason: claim.reason || "Причина непроверенности не указана"
      };
    });
  }
  
  return result;
}

function showAnalysisNotification(analysisId, verdict) {
  let message = '';
  let iconUrl = 'pictures/icon48.png';
  
  if (verdict === 'Правдивые') {
    message = '✅ Анализ завершен: Новости правдивые';
  } else if (verdict === 'Недостоверные') {
    message = '❌ Анализ завершен: Новости недостоверные';
  } else {
    message = '⚠️ Анализ завершен: Новости частично правдивые';
  }
  
  chrome.notifications.create(analysisId, {
    type: 'basic',
    iconUrl: iconUrl,
    title: 'VacLive - Анализ завершен',
    message: message,
    priority: 1
  });
}

chrome.notifications.onClicked.addListener(async (notificationId) => {
  if (notificationId.startsWith('analysis_')) {
    chrome.action.openPopup();
    chrome.notifications.clear(notificationId);
  }
});

async function saveAnalysisToHistory(analysisData) {
  try {
      const result = await chrome.storage.local.get(['analysisHistory']);
      let analysisHistory = result.analysisHistory || [];
      
      analysisHistory.unshift({
          id: 'analysis_' + Date.now(),
          title: analysisData.title,
          text: analysisData.text.substring(0, 500) + (analysisData.text.length > 500 ? '...' : ''),
          result: analysisData.result,
          timestamp: new Date().toISOString()
      });
      
      if (analysisHistory.length > 50) {
          analysisHistory = analysisHistory.slice(0, 50);
      }
      
      await chrome.storage.local.set({ analysisHistory });
      
      console.log('Анализ сохранен в историю');
  } catch (error) {
      console.error('Ошибка при сохранении в историю:', error);
  }
}

chrome.runtime.onStartup.addListener(() => {
  activeAnalyses.clear();
});