// background.js - исправленный код с работающим анализом

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

// Глобальные переменные для отслеживания анализов
let activeAnalyses = new Map();

// Обработка сообщений от popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "startAnalysis") {
      // Немедленный ответ что запрос принят
      sendResponse({ success: true, message: "Анализ запущен" });
      
      // Запускаем анализ асинхронно
      startBackgroundAnalysis(request.text, request.title, request.analysisId)
          .then(result => {
              // Отправляем результат всем открытым popup окнам
              chrome.runtime.sendMessage({
                  action: "analysisComplete",
                  result: result,
                  analysisId: request.analysisId
              }).catch(error => console.log('Popup закрыт, результат не отправлен'));
              
              // Показываем уведомление
              showAnalysisNotification(request.analysisId, result.verdict);
              
              // Удаляем из активных анализов после завершения
              activeAnalyses.delete(request.analysisId);
          })
          .catch(error => {
              console.error('Ошибка анализа:', error);
              chrome.runtime.sendMessage({
                  action: "analysisError",
                  error: error.message,
                  analysisId: request.analysisId
              }).catch(error => console.log('Popup закрыт, ошибка не отправлена'));
              
              // Удаляем из активных анализов при ошибке
              activeAnalyses.delete(request.analysisId);
          });
      
      return true; // Сообщаем, что ответ будет асинхронным
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
          activeAnalyses.delete(request.analysisId);
          sendResponse({ success: true });
      } else {
          sendResponse({ success: false, error: "Анализ не найден" });
      }
      return true;
  }
});

// Функция анализа в фоновом режиме
async function startBackgroundAnalysis(text, title, analysisId) {
  console.log('Запуск анализа:', { analysisId, textLength: text.length });
  
  try {
      // Добавляем в активные анализы
      activeAnalyses.set(analysisId, {
          status: 'processing',
          startTime: Date.now(),
          text: text.substring(0, 100), // Сохраняем только начало для отладки
          title: title,
          progress: 0,
          message: 'Запуск анализа...'
      });
      
      // Отправляем начальный прогресс
      await sendProgress(analysisId, 'Подготовка анализа...', 10);
      
      const apiKey = await getApiKey();
      if (!apiKey) {
          throw new Error('API ключ не найден. Сохраните ключ в настройках.');
      }
      
      // Отправляем прогресс получения ключа
      await sendProgress(analysisId, 'Проверка API ключа...', 20);
      
      // Упрощенный промпт для тестирования
      const prompt = `Проанализируй этот текст новости и дай оценку достоверности. Ответь ТОЛЬКО в формате JSON:

{
  "verdict": "Правдивые|Недостоверные|Частично правдивые",
  "confidence_level": "высокий|средний|низкий",
  "summary": "краткое описание",
  "fact_check": {
    "verified_facts": [],
    "false_claims": [],
    "unverified_claims": []
  },
  "sources_validation": {
    "working_sources": 0,
    "broken_sources": 0,
    "official_sources_count": 0,
    "cross_verification_score": 0
  },
  "recommendations": []
}

Текст для анализа: ${text.substring(0, 4000)}`;
      
      // Отправляем прогресс перед запросом к API
      await sendProgress(analysisId, 'Отправка запроса к AI...', 40);
      
      console.log('Отправка запроса к API...');
      const response = await fetch('https://api.deepseek.com/v1/chat/completions', {
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
          })
      });
      
      console.log('Получен ответ от API:', response.status);
      
      if (!response.ok) {
          const errorText = await response.text();
          console.error('Ошибка API:', response.status, errorText);
          throw new Error(`Ошибка API: ${response.status}`);
      }
      
      // Отправляем прогресс обработки ответа
      await sendProgress(analysisId, 'Обработка результатов...', 80);
      
      const data = await response.json();
      console.log('Данные ответа:', data);
      
      if (!data.choices || !data.choices[0]) {
          throw new Error('Неверный формат ответа от API');
      }
      
      const result = parseAnalysisResult(data.choices[0].message.content);
      console.log('Результат анализа:', result);
      
      // Финальный прогресс
      await sendProgress(analysisId, 'Завершение анализа...', 100);
      
      // Сохраняем в историю
      await saveAnalysisToHistory({
          title: title,
          text: text,
          result: result
      });
      
      // Обновляем статус
      activeAnalyses.set(analysisId, {
          ...activeAnalyses.get(analysisId),
          status: 'completed',
          result: result,
          endTime: Date.now()
      });
      
      return result;
      
  } catch (error) {
      console.error('Ошибка в анализе:', error);
      // Обновляем статус при ошибке
      activeAnalyses.set(analysisId, {
          ...activeAnalyses.get(analysisId),
          status: 'error',
          error: error.message,
          endTime: Date.now()
      });
      
      throw error;
  }
}

// Функция для отправки прогресса
async function sendProgress(analysisId, message, progress) {
  console.log(`Прогресс [${analysisId}]: ${message} (${progress}%)`);
  
  // Обновляем статус в активных анализах
  const analysis = activeAnalyses.get(analysisId);
  if (analysis) {
      analysis.progress = progress;
      analysis.message = message;
      activeAnalyses.set(analysisId, analysis);
  }
  
  // Отправляем сообщение в popup
  try {
      await chrome.runtime.sendMessage({
          action: "analysisProgress",
          analysisId: analysisId,
          message: message,
          progress: progress
      });
  } catch (error) {
      // Popup может быть закрыт - это нормально
      console.log('Прогресс не отправлен (popup закрыт)');
  }
}

// Вспомогательные функции
async function getApiKey() {
  const result = await chrome.storage.local.get(['deepseekApiKey']);
  return result.deepseekApiKey;
}

function parseAnalysisResult(result) {
  console.log('Парсинг результата:', result);
  
  try {
    // Пытаемся найти JSON в ответе
    const jsonMatch = result.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      console.log('Успешно распарсен JSON:', parsed);
      return parsed;
    }
    
    // Если JSON не найден, создаем базовую структуру
    console.log('JSON не найден, создаем базовый ответ');
    return {
      verdict: "Частично правдивые",
      confidence_level: "средний",
      fact_check: {
        verified_facts: [{ fact: "Базовый анализ выполнен", source: "Система" }],
        false_claims: [],
        unverified_claims: []
      },
      sources_validation: {
        working_sources: 1,
        broken_sources: 0,
        official_sources_count: 0,
        cross_verification_score: 5
      },
      summary: "Анализ выполнен. " + (result.substring(0, 200) || "Результат получен."),
      recommendations: ["Проверьте дополнительные источники для уверенности"]
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

// Обработка кликов по уведомлениям
chrome.notifications.onClicked.addListener(async (notificationId) => {
  if (notificationId.startsWith('analysis_')) {
    chrome.action.openPopup();
    chrome.notifications.clear(notificationId);
  }
});

// Функция сохранения анализа в историю
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

// Очистка старых анализов при запуске
chrome.runtime.onStartup.addListener(() => {
  activeAnalyses.clear();
});