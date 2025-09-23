function showCustomToast(message) {
    const toast = document.getElementById('customToast');
    const toastText = document.getElementById('customToastText');
    if (!toast || !toastText) return;
    toastText.textContent = message;
    toast.classList.add('show');
    setTimeout(() => {
        toast.classList.remove('show');
    }, 2200);
}
const CONFIG = {
    MAX_TEXT_LENGTH: 80000,
    ANALYSIS_PROMPT: `Ты — профессиональный фактчекер. Проанализируй предоставленный текст новости и дай четкую оценку достоверности.

**КРИТЕРИИ АНАЛИЗА:**
1. Проверь ВСЕ ключевые факты: даты, имена, цифры, события, цитаты
2. Сравни информацию с ОФИЦИАЛЬНЫМИ ИСТОЧНИКАМИ (госсайты, пресс-релизы, проверенные СМИ)
3. Используй перекрестную проверку: информация должна подтверждаться минимум 2-3 независимыми источниками
4. Особое внимание удели совпадению с официальными данными

**ТРЕБОВАНИЯ К ИСТОЧНИКАМ:**
- Сайт ДОЛЖЕН БЫТЬ РАБОЧИМ и доступным (проверь статус 200)
- Содержание ДОЛЖНО СООТВЕТСТВОВАТЬ теме проверяемого факта
- Приоритет официальным источникам (.gov.ru, .kremlin.ru и т.д.)
- Проверенные СМИ с хорошей репутацией

**ПРОВЕРЬ КАЖДУЮ ССЫЛКУ ПЕРЕД ИСПОЛЬЗОВАНИЕМ:**
- Открывается ли сайт?
- Есть ли на странице нужная информация?
- Актуальна ли дата публикации?
- Не является ли сайт сатирическим/фейковым?

**ВЕРДИКТ ДОЛЖЕН БЫТЬ ЧЕТКИМ:**
- "Правдивые" - если ВСЕ факты подтверждены РАБОЧИМИ официальными источниками
- "Недостоверные" - если есть ложные факты или источники нерабочие
- "Частично правдивые" - если часть информации подтверждена рабочими источниками

Верни ответ ТОЛЬКО в формате JSON:
{
    "verdict": "Правдивые|Недостоверные|Частично правдивые",
    "confidence_level": "высокий|средний|низкий",
    "fact_check": {
        "verified_facts": [
            {
                "fact": "конкретный факт",
                "source": "https://рабочий-официальный-источник.ru",
                "source_status": "рабочий|проверен",
                "content_match": "полное|частичное|не соответствует"
            }
        ],
        "false_claims": [
            {
                "claim": "ложное утверждение", 
                "contradiction_source": "https://опровергающий-источник.ru",
                "source_status": "рабочий|проверен",
                "contradiction_type": "прямое опровержение|отсутствие данных"
            }
        ],
        "unverified_claims": [
            {
                "claim": "неподтвержденное утверждение",
                "reason": "нет данных в рабочих источниках|источники недоступны",
                "attempted_sources": ["https://источник1", "https://источник2"]
            }
        ]
    },
    "sources_validation": {
        "working_sources": число,
        "broken_sources": число,
        "official_sources_count": число,
        "cross_verification_score": число_0-10
    },
    "summary": "краткое обоснование с акцентом на проверке источников",
    "recommendations": ["рекомендация1", "рекомендация2"]
}`
};

let currentTheme = 'light';
let analysisHistory = [];

document.addEventListener('DOMContentLoaded', async function() {
    const result = await chrome.storage.local.get(['analysedText']);
    if (result.analysedText) {
        const textArea = document.getElementById('analyzeText');
        if (textArea) {
            textArea.value = result.analysedText;
            await chrome.storage.local.remove('analysedText');
        }
    }
    initializeApp();
});

async function initializeApp() {
    await loadSettings();
    setupEventListeners();
    setupTabs();
    loadAnalysisHistory();
}

function setupEventListeners() {
    document.getElementById('menuBtn').addEventListener('click', function(e) {
        e.stopPropagation();
        const popup = document.getElementById('menuPopup');
        popup.style.display = popup.style.display === 'none' ? 'block' : 'none';
    });
    
    document.getElementById('changeKeyBtn').addEventListener('click', function() {
        enterApiKeyMode();
    });
    
    document.addEventListener('click', function(e) {
        const popup = document.getElementById('menuPopup');
        if (popup.style.display === 'block' && !popup.contains(e.target) && e.target.id !== 'menuBtn') {
            popup.style.display = 'none';
        }
    });
    
    document.getElementById('themeToggle').addEventListener('click', toggleTheme);
    document.getElementById('sendBtn').addEventListener('click', sendMessage);
    document.getElementById('userInput').addEventListener('keypress', e => {
        if (e.key === 'Enter') sendMessage();
    });
    
    document.getElementById('analyzeTextBtn').addEventListener('click', analyzeTextHandler);
    document.getElementById('analyzePage').addEventListener('click', analyzeCurrentPage);
    
    document.getElementById('saveKey').addEventListener('click', saveApiKey);
    document.getElementById('clearKey').addEventListener('click', clearApiKey);
    document.getElementById('clearHistory').addEventListener('click', clearAnalysisHistory);
    document.getElementById('exportHistory').addEventListener('click', exportHistory);
}

function enterApiKeyMode() {
    document.body.classList.add('api-key-mode');
    document.getElementById('apiSection').style.display = 'flex';
    document.getElementById('menuPopup').style.display = 'none';
    
    chrome.storage.local.get(['deepseekApiKey']).then(result => {
        if (result.deepseekApiKey) {
            document.getElementById('apiKey').value = result.deepseekApiKey;
        }
    });
}

function exitApiKeyMode() {
    document.body.classList.remove('api-key-mode');
    document.getElementById('apiSection').style.display = 'none';
    
    const activeTab = document.querySelector('.tab.active');
    if (activeTab) {
        const tabName = activeTab.getAttribute('data-tab');
        document.getElementById(`${tabName}-tab`).classList.add('active');
    }
}

function setupTabs() {
    const tabs = document.querySelectorAll('.tab');
    const tabContents = document.querySelectorAll('.tab-content');
    const indicator = document.querySelector('.tab-indicator');
    const tabsContainer = document.querySelector('.tabs');

    function moveIndicator() {
        const activeTab = tabsContainer.querySelector('.tab.active');
        if (activeTab && indicator) {
            const rect = activeTab.getBoundingClientRect();
            const containerRect = tabsContainer.getBoundingClientRect();
            
            indicator.style.left = (rect.left - containerRect.left) + 'px';
            indicator.style.width = rect.width + 'px';
            indicator.style.height = (rect.height - 8) + 'px';
        }
    }

    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            const tabName = tab.getAttribute('data-tab');
            
            
            tabs.forEach(t => t.classList.remove('active'));
            tabContents.forEach(tc => tc.classList.remove('active'));
            
            
            tab.classList.add('active');
            document.getElementById(`${tabName}-tab`).classList.add('active');
            
            
            moveIndicator();
            
            
            if (tabName === 'history') {
                displayAnalysisHistory();
            }
        });
    });

    
    window.addEventListener('resize', moveIndicator);
    
    
    setTimeout(moveIndicator, 100);
}

async function toggleTheme() {
    currentTheme = currentTheme === 'light' ? 'dark' : 'light';
    document.body.setAttribute('data-theme', currentTheme);
    await chrome.storage.local.set({ theme: currentTheme });
}

async function analyzeCurrentPage() {
    try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        
        const results = await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            func: extractFullPageContent
        });
        
        if (results[0].result) {
            const pageContent = results[0].result;
            document.getElementById('analyzeText').value = pageContent;
            await performAnalysis(pageContent, `Анализ страницы: ${tab.title}`);
        }
    } catch (error) {
        showError('Не удалось получить содержимое страницы. Убедитесь, что у расширения есть необходимые разрешения.');
    }
}

function extractFullPageContent() {
    const contentSelectors = [
        'article', 'main', '.content', '.post', '.article', '.story', 
        '.entry-content', '.post-content', '[role="main"]', '.news-content', '.blog-content'
    ];

    let content = '';
    let title = document.title || '';

    function getVisibleText(element) {
        let text = '';
        for (const node of element.childNodes) {
            if (node.nodeType === Node.TEXT_NODE) {
                if (node.textContent.trim() && isVisible(node.parentElement)) {
                    text += node.textContent + ' ';
                }
            } else if (node.nodeType === Node.ELEMENT_NODE) {
                const tag = node.tagName.toLowerCase();
                if ([
                    'script', 'style', 'meta', 'head', 'noscript', 'svg', 'canvas', 
                    'iframe', 'object', 'embed', 'picture', 'source', 'template', 'link'
                ].includes(tag)) continue;
                if (isVisible(node)) {
                    text += getVisibleText(node);
                }
            }
        }
        return text;
    }

    function isVisible(el) {
        if (!el || !(el instanceof Element)) return false;
        const style = window.getComputedStyle(el);
        return style && style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
    }

    for (const selector of contentSelectors) {
        const element = document.querySelector(selector);
        if (element && isVisible(element)) {
            content = getVisibleText(element);
            break;
        }
    }

    if (!content) {
        content = getVisibleText(document.body);
    }

    content = content.replace(/\s+/g, ' ').replace(/\n/g, ' ').trim();

    const maxLength = 8000;
    if (content.length > maxLength) {
        content = content.substring(0, maxLength) + '... [текст обрезан]';
    }

    return `ЗАГОЛОВОК: ${title}\n\nКОНТЕНТ СТРАНИЦЫ:\n${content}`;
}

async function analyzeTextHandler() {
    const text = document.getElementById('analyzeText').value.trim();
    if (!text) {
        showError('Введите текст для анализа');
        return;
    }
    
    await performAnalysis(text, 'Анализ текста');
}

async function performAnalysis(text, title = 'Анализ') {
    const analyzeBtn = document.getElementById('analyzeTextBtn');
    const originalText = analyzeBtn.textContent;
    
    try {
        analyzeBtn.innerHTML = '<span class="loading"></span> Анализируем...';
        analyzeBtn.disabled = true;
        
        const result = await analyzeTextWithAI(text);
        displayAnalysisResult(result);
        
        await saveToAnalysisHistory({
            title: title,
            text: text.substring(0, 500) + (text.length > 500 ? '...' : ''),
            result: result,
            timestamp: new Date().toISOString()
        });
        
    } catch (error) {
        showError(error.message);
    } finally {
        analyzeBtn.textContent = originalText;
        analyzeBtn.disabled = false;
    }
}

async function analyzeTextWithAI(text) {
    if (!text.trim()) {
        throw new Error('Введите текст для анализа');
    }
    
    const apiKey = await getApiKey();
    if (!apiKey) {
        throw new Error('API ключ не найден. Сохраните ключ в настройках.');
    }
    
    const prompt = `${CONFIG.ANALYSIS_PROMPT}\n\nТЕКСТ ДЛЯ АНАЛИЗА:\n${text.substring(0, CONFIG.MAX_TEXT_LENGTH)}`;
    
    const response = await fetch('https://api.deepseek.com/v1/chat/completions', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify({
            model: 'deepseek-chat',
            messages: [
                {
                    role: 'system',
                    content: 'Ты профессиональный фактчекер. Твоя задача - анализировать новости и проверять факты.'
                },
                {
                    role: 'user',
                    content: prompt
                }
            ],
            max_tokens: 4000,
            temperature: 0.1
        })
    });
    
    if (!response.ok) {
        const errorData = await response.text();
        throw new Error(`Ошибка API: ${response.status} - ${errorData}`);
    }
    
    const data = await response.json();
    const content = data.choices[0].message.content;
    
    try {
        return JSON.parse(content);
    } catch (e) {
        throw new Error('Неверный формат ответа от AI');
    }
}

function displayAnalysisResult(result) {
    const resultContainer = document.getElementById('analysisResult');
    resultContainer.innerHTML = '';
    
    if (!result || typeof result !== 'object') {
        resultContainer.innerHTML = '<div class="error-message">Ошибка: неверный формат результата анализа</div>';
        return;
    }
    
    let verdictClass = 'verdict-warning';
    if (result.verdict === 'Правдивые') verdictClass = 'verdict-true';
    else if (result.verdict === 'Недостоверные') verdictClass = 'verdict-false';
    
    const html = `
        <div class="verdict-header ${verdictClass}">
            Вердикт: ${result.verdict || 'Не определен'}
        </div>
        
        ${result.confidence_level ? `
            <div class="confidence-level">
                Уровень уверенности: ${result.confidence_level}
            </div>
        ` : ''}
        
        ${result.summary ? `
            <div class="analysis-item">
                <strong>Обоснование:</strong><br>
                ${result.summary}
            </div>
        ` : ''}
        
        ${result.fact_check?.verified_facts?.length ? `
            <div class="analysis-item">
                <strong>Подтвержденные факты:</strong>
                ${result.fact_check.verified_facts.map(fact => `
                    <div class="fact-item verified">
                        <strong>✓ ${fact.fact}</strong><br>
                        Источник: <a href="${fact.source}" target="_blank">${fact.source}</a><br>
                        Статус: ${fact.source_status || 'не указан'} | Соответствие: ${fact.content_match || 'не указано'}
                    </div>
                `).join('')}
            </div>
        ` : ''}
        
        ${result.fact_check?.false_claims?.length ? `
            <div class="analysis-item">
                <strong>Ложные утверждения:</strong>
                ${result.fact_check.false_claims.map(claim => `
                    <div class="fact-item false">
                        <strong>✗ ${claim.claim}</strong><br>
                        Опровержение: <a href="${claim.contradiction_source}" target="_blank">${claim.contradiction_source}</a><br>
                        Статус: ${claim.source_status || 'не указан'} | Тип: ${claim.contradiction_type || 'не указан'}
                    </div>
                `).join('')}
            </div>
        ` : ''}
        
        ${result.fact_check?.unverified_claims?.length ? `
            <div class="analysis-item">
                <strong>Неподтвержденные утверждения:</strong>
                ${result.fact_check.unverified_claims.map(claim => `
                    <div class="fact-item unverified">
                        <strong>? ${claim.claim}</strong><br>
                        Причина: ${claim.reason}<br>
                        Проверенные источники: ${claim.attempted_sources?.join(', ') || 'не указаны'}
                    </div>
                `).join('')}
            </div>
        ` : ''}
        
        ${result.sources_validation ? `
            <div class="analysis-item">
                <strong>Проверка источников:</strong><br>
                Рабочих источников: ${result.sources_validation.working_sources || 0}<br>
                Недоступных источников: ${result.sources_validation.broken_sources || 0}<br>
                Официальных источников: ${result.sources_validation.official_sources_count || 0}<br>
                Оценка перекрестной проверки: ${result.sources_validation.cross_verification_score || 0}/10
            </div>
        ` : ''}
        
        ${result.recommendations?.length ? `
            <div class="analysis-item">
                <strong>Рекомендации:</strong><br>
                <ul>
                    ${result.recommendations.map(rec => `<li>${rec}</li>`).join('')}
                </ul>
            </div>
        ` : ''}
    `;
    
    resultContainer.innerHTML = html;
}

async function sendMessage() {
    const input = document.getElementById('userInput');
    const message = input.value.trim();
    
    if (!message) return;
    
    addMessage(message, 'user');
    input.value = '';
    
    try {
        const response = await sendMessageToAI(message);
        addMessage(response, 'bot');
    } catch (error) {
        addMessage(`Ошибка: ${error.message}`, 'bot');
    }
}

async function sendMessageToAI(message) {
    const apiKey = await getApiKey();
    if (!apiKey) {
        throw new Error('API ключ не найден. Сохраните ключ в настройках.');
    }
    
    const response = await fetch('https://api.deepseek.com/v1/chat/completions', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify({
            model: 'deepseek-chat',
            messages: [
                {
                    role: 'system',
                    content: 'Ты полезный AI помощник для проверки фактов. Отвечай точно и информативно.'
                },
                {
                    role: 'user',
                    content: message
                }
            ],
            max_tokens: 2000,
            temperature: 0.7
        })
    });
    
    if (!response.ok) {
        throw new Error(`Ошибка API: ${response.status}`);
    }
    
    const data = await response.json();
    return data.choices[0].message.content;
}

function addMessage(text, sender) {
    const messagesContainer = document.getElementById('messages');
    const messageDiv = document.createElement('div');
    messageDiv.className = `message ${sender}-message`;
    messageDiv.textContent = text;
    
    messagesContainer.appendChild(messageDiv);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

function showError(message) {
    const errorDiv = document.createElement('div');
    errorDiv.className = 'error-message';
    errorDiv.textContent = message;
    
    const container = document.querySelector('.tab-content.active .messages-container');
    container.appendChild(errorDiv);
    container.scrollTop = container.scrollHeight;
    
    setTimeout(() => errorDiv.remove(), 5000);
}

async function saveApiKey() {
    const apiKey = document.getElementById('apiKey').value.trim();
    if (!apiKey) {
        showCustomToast('Введите API ключ');
        return;
    }

   
    try {
        const resp = await fetch('https://api.deepseek.com/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`
            },
            body: JSON.stringify({
                model: 'deepseek-chat',
                messages: [{ role: 'user', content: 'ping' }],
                max_tokens: 1,
                temperature: 0.1
            })
        });
        if (!resp.ok) {
            if (resp.status === 401 || resp.status === 403) {
                showCustomToast('Неверный API ключ!');
                return;
            } else {
                showCustomToast('Ошибка проверки ключа: ' + resp.status);
                return;
            }
        }
        
        await chrome.storage.local.set({ deepseekApiKey: apiKey });
        exitApiKeyMode();
        showCustomToast('API ключ сохранён!');
    } catch (e) {
        showCustomToast('Ошибка сети при проверке ключа');
    }
}

async function clearApiKey() {
    await chrome.storage.local.remove('deepseekApiKey');
    document.getElementById('apiKey').value = '';
    showCustomToast('API ключ удалён!');
}

function showSuccess(message) {
    const successDiv = document.createElement('div');
    successDiv.className = 'success-message';
    successDiv.textContent = message;
    
    const container = document.querySelector('.tab-content.active .messages-container');
    container.appendChild(successDiv);
    container.scrollTop = container.scrollHeight;
    
    setTimeout(() => successDiv.remove(), 3000);
}

async function getApiKey() {
    const result = await chrome.storage.local.get(['deepseekApiKey']);
    return result.deepseekApiKey;
}

async function loadSettings() {
    const result = await chrome.storage.local.get(['theme', 'deepseekApiKey']);
    
    if (result.theme) {
        currentTheme = result.theme;
        document.body.setAttribute('data-theme', currentTheme);
    }
    
    if (!result.deepseekApiKey) {
        enterApiKeyMode();
    }
}

async function saveToAnalysisHistory(analysis) {
    analysisHistory.unshift(analysis);
    if (analysisHistory.length > 50) {
        analysisHistory = analysisHistory.slice(0, 50);
    }
    await chrome.storage.local.set({ analysisHistory });
}

async function loadAnalysisHistory() {
    const result = await chrome.storage.local.get(['analysisHistory']);
    analysisHistory = result.analysisHistory || [];
}

function displayAnalysisHistory() {
    const historyList = document.getElementById('historyList');
    
    if (analysisHistory.length === 0) {
        historyList.innerHTML = '<div class="message bot-message">История проверок пуста</div>';
        return;
    }
    
    historyList.innerHTML = analysisHistory.map((item, index) => `
        <div class="history-item" data-index="${index}">
            <strong>${item.title}</strong><br>
            <small>${new Date(item.timestamp).toLocaleString('ru-RU')}</small><br>
            <span style="color: var(--text-secondary);">${item.text}</span>
        </div>
    `).join('');
    
    document.querySelectorAll('.history-item').forEach(item => {
        item.addEventListener('click', function() {
            const index = parseInt(this.getAttribute('data-index'));
            displayHistoryItem(analysisHistory[index]);
        });
    });
}

function displayHistoryItem(item) {
    const historyList = document.getElementById('historyList');
    historyList.innerHTML = `
        <div style="padding: 16px;">
            <button id="backToHistory" class="btn btn-secondary" style="margin-bottom: 16px;">
                ← Назад к истории
            </button>
            <h3 style="margin-bottom: 12px;">${item.title}</h3>
            <p style="color: var(--text-secondary); margin-bottom: 16px;">
                ${new Date(item.timestamp).toLocaleString('ru-RU')}
            </p>
            <div style="background: var(--card); padding: 16px; border-radius: var(--radius-md); margin-bottom: 16px;">
                <strong>Анализируемый текст:</strong><br>
                ${item.text}
            </div>
        </div>
    `;
    
    const resultContainer = document.createElement('div');
    resultContainer.style.padding = '0 16px 16px';
    resultContainer.innerHTML = '<strong>Результаты анализа:</strong>';
    historyList.appendChild(resultContainer);
    
    displayAnalysisResult(item.result);
    
    document.getElementById('backToHistory').addEventListener('click', displayAnalysisHistory);
}

async function clearAnalysisHistory() {
    analysisHistory = [];
    await chrome.storage.local.set({ analysisHistory: [] });
    displayAnalysisHistory();
    showSuccess('История очищена');
}

function exportHistory() {
    if (analysisHistory.length === 0) {
        showError('История проверок пуста');
        return;
    }
    
    const dataStr = JSON.stringify(analysisHistory, null, 2);
    const dataBlob = new Blob([dataStr], { type: 'application/json' });
    
    const link = document.createElement('a');
    link.href = URL.createObjectURL(dataBlob);
    link.download = `factcheck-history-${new Date().toISOString().split('T')[0]}.json`;
    link.click();
}