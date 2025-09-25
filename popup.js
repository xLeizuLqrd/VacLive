const CONFIG = {
    MAX_TEXT_LENGTH: 8000
};

let currentTheme = 'light';
let analysisHistory = [];
let chatHistory = [];
let currentAnalysisId = null;
let currentAnalysisState = null;
let currentMessageHandler = null;
let analysisResultAlreadyShown = false;


document.addEventListener('DOMContentLoaded', async function() {
    chrome.runtime.onMessage.addListener(async (request, sender, sendResponse) => {
        if (request.action === 'showChatFromNotification') {
            const chatTab = document.querySelector('[data-tab="chat"]');
            if (chatTab) chatTab.click();
        }
        if (request.action === 'showAnalyzerFromContextMenu') {
            const analyzerTab = document.querySelector('[data-tab="analyzer"]');
            if (analyzerTab) analyzerTab.click();
            const result = await chrome.storage.local.get(['analysedText']);
            if (result.analysedText && document.getElementById('analyzeText')) {
                document.getElementById('analyzeText').value = result.analysedText;
                await chrome.storage.local.remove('analysedText');
            }
        }
    });
    await initializeApp();
    const themeToggle = document.getElementById('themeToggle');
    const themeIcon = document.getElementById('themeIcon');
    const themeText = document.getElementById('themeText');

    function updateThemeIcon() {
        const isDark = document.body.getAttribute('data-theme') === 'dark';
        themeIcon.src = isDark ? 'pictures/sun32.png' : 'pictures/moon32.png';
        themeText.textContent = isDark ? 'Светлая' : 'Тёмная';
    }

    updateThemeIcon();
    if (themeToggle) {
        themeToggle.addEventListener('click', function () {
            setTimeout(updateThemeIcon, 100);
        });
    }

    chrome.runtime.onMessage.addListener(async (request, sender, sendResponse) => {
        if (request.action === 'showAnalysisFromNotification') {
            const historyTab = document.querySelector('[data-tab="history"]');
            if (historyTab) historyTab.click();
            await loadAnalysisHistory();
            let idx = analysisHistory.findIndex(a => a.analysisId === request.analysisId);
            if (idx === -1) idx = 0;
            const item = analysisHistory[idx];
            const historyListContainer = document.getElementById('historyListContainer');
            const historyReportContainer = document.getElementById('historyReportContainer');
            if (historyListContainer) historyListContainer.style.display = 'none';
            if (historyReportContainer) historyReportContainer.style.display = '';
            const reportDiv = document.getElementById('historyFullReport');
            if (reportDiv && item) {
                reportDiv.innerHTML = '';
                displayAnalysisResult(item.result, reportDiv);
            }
        }
    });
});

async function initializeApp() {
    await loadSettings();
    setupEventListeners();
    setupTabs();
    await loadAnalysisHistory();
    await loadChatHistory();
    const { pendingUserMessage } = await chrome.storage.local.get(['pendingUserMessage']);
    const messagesDiv = document.getElementById('messages');
    if (pendingUserMessage) {
        const userMessage = { role: 'user', content: pendingUserMessage };
        let lastUserIdx = -1;
        for (let i = chatHistory.length - 1; i >= 0; i--) {
            if (chatHistory[i].role === 'user' && chatHistory[i].content === userMessage.content) {
                lastUserIdx = i;
                break;
            }
        }
        let hasAssistantAfter = false;
        if (lastUserIdx !== -1) {
            for (let i = lastUserIdx + 1; i < chatHistory.length; i++) {
                if (chatHistory[i].role === 'assistant') {
                    hasAssistantAfter = true;
                    break;
                }
            }
        }
        if (hasAssistantAfter) {
            displayChatHistory();
            const loadingDiv = messagesDiv.querySelector('.loading');
            if (loadingDiv && loadingDiv.parentElement) loadingDiv.parentElement.remove();
        } else {
            const lastIsUser = chatHistory.length && chatHistory[chatHistory.length-1].role === 'user' && chatHistory[chatHistory.length-1].content === userMessage.content;
            const hasLoading = !!messagesDiv.querySelector('.loading');
            if (!(lastIsUser && hasLoading)) {
                if (!lastIsUser) chatHistory.push(userMessage);
                displayChatHistory();
                if (!hasLoading) {
                    const loadingDiv = document.createElement('div');
                    loadingDiv.className = 'message bot-message';
                    loadingDiv.innerHTML = '<div class="loading"></div> Думаю...';
                    messagesDiv.appendChild(loadingDiv);
                }
                setTimeout(() => {
                    const loadingDiv = messagesDiv.querySelector('.loading');
                    if (loadingDiv && loadingDiv.parentElement) {
                        const parent = loadingDiv.parentElement;
                        const prevDisplay = parent.style.display;
                        parent.style.display = '';
                        parent.scrollIntoView({ behavior: 'smooth', block: 'end' });
                        parent.style.display = prevDisplay;
                        setTimeout(() => { messagesDiv.scrollTop = messagesDiv.scrollHeight; }, 150);
                    } else {
                        messagesDiv.scrollTop = messagesDiv.scrollHeight;
                    }
                }, 0);
            }
        }
    } else {
        const loadingDiv = messagesDiv.querySelector('.loading');
        if (loadingDiv && loadingDiv.parentElement) loadingDiv.parentElement.remove();
    }
    await clearPendingUserMessage();
    await showLastAnalysisResultIfAny();
    await restoreAnalysisState();

    chrome.runtime.onMessage.addListener(async (request, sender, sendResponse) => {
        if (request.action === 'chatBotResponse') {
            const messagesDiv = document.getElementById('messages');
            const loadingDiv = messagesDiv.querySelector('.loading')?.parentElement;
            if (loadingDiv) loadingDiv.remove();
            await loadChatHistory();
        }
    });

async function clearPendingUserMessage() {
    await chrome.storage.local.remove('pendingUserMessage');
}
}

async function showLastAnalysisResultIfAny() {
    const result = await chrome.storage.local.get(['lastAnalysisResult']);
    if (result.lastAnalysisResult) {
        const historyTab = document.querySelector('[data-tab="history"]');
        if (historyTab) historyTab.click();
        setTimeout(async () => {
            await loadAnalysisHistory();
            const historyListContainer = document.getElementById('historyListContainer');
            const historyReportContainer = document.getElementById('historyReportContainer');
            if (historyListContainer) historyListContainer.style.display = 'none';
            if (historyReportContainer) historyReportContainer.style.display = '';
            const reportDiv = document.getElementById('historyFullReport');
            if (reportDiv && analysisHistory.length > 0) {
                reportDiv.innerHTML = '';
                displayAnalysisResult(analysisHistory[0].result, reportDiv);
            }
        }, 200);
        analysisResultAlreadyShown = true;
        await chrome.storage.local.set({ lastAnalysisShownDate: Date.now() });
        await chrome.storage.local.remove('lastAnalysisResult');
    }
}

function setupEventListeners() {
    document.getElementById('menuBtn').addEventListener('click', function(e) {
        e.stopPropagation();
        const popup = document.getElementById('menuPopup');
        popup.style.display = popup.style.display === 'none' ? 'block' : 'none';
    });
    
    document.getElementById('changeKeyBtn').addEventListener('click', function() {
        document.getElementById('apiSection').style.display = '';
        document.getElementById('menuBtn').style.display = 'none';
        document.getElementById('menuPopup').style.display = 'none';
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
    document.getElementById('clearData').addEventListener('click', clearAllData);
    document.getElementById('clearHistory').addEventListener('click', clearAnalysisHistory);
    document.getElementById('exportHistory').addEventListener('click', exportHistory);
}

async function restoreAnalysisState() {
    try {
        const { lastAnalysisShownDate, currentAnalysisId: storedId, currentAnalysisStatus } = await chrome.storage.local.get(['lastAnalysisShownDate', 'currentAnalysisId', 'currentAnalysisStatus']);
        if (lastAnalysisShownDate && Date.now() - lastAnalysisShownDate < 60000) return;
        if (analysisResultAlreadyShown) return;
        const result = await chrome.storage.local.get(['currentAnalysis', 'analysedText']);
        if (result.analysedText) {
            const textArea = document.getElementById('analyzeText');
            if (textArea) {
                textArea.value = result.analysedText;
                await chrome.storage.local.remove('analysedText');
                const analyzerTab = document.querySelector('[data-tab="analyzer"]');
                if (analyzerTab) analyzerTab.click();
            }
        }
        if (storedId && currentAnalysisStatus === 'processing') {
            currentAnalysisId = storedId;
            document.querySelector('[data-tab="analyzer"]').click();
            setupMessageHandler();
            chrome.runtime.sendMessage({
                action: "getAnalysisStatus",
                analysisId: currentAnalysisId
            }, function(response) {
                if (chrome.runtime.lastError) {
                    handleAnalysisError('Сервис анализа недоступен');
                    return;
                }
                if (response && response.analysis) {
                    if (response.analysis.status === 'processing') {
                        showProgress(response.analysis.message || 'Анализ выполняется...', response.analysis.progress || 50);
                    } else if (response.analysis.status === 'completed' && response.analysis.result) {
                        handleAnalysisComplete(response.analysis.result);
                    } else if (response.analysis.status === 'error') {
                        handleAnalysisError(response.analysis.error || 'Произошла ошибка анализа');
                    } else {
                        handleAnalysisError('Неизвестный статус анализа: ' + response.analysis.status);
                    }
                } else {
                    handleAnalysisError('Анализ не найден или был прерван');
                }
            });
        } else if (result.currentAnalysis) {
            currentAnalysisState = result.currentAnalysis;
            currentAnalysisId = currentAnalysisState.analysisId;
            if (currentAnalysisState.status === 'processing') {
                showProgress(currentAnalysisState.message || 'Восстановление анализа...', currentAnalysisState.progress || 0);
                if (currentAnalysisState.text) {
                    document.getElementById('analyzeText').value = currentAnalysisState.text;
                }
                document.querySelector('[data-tab="analyzer"]').click();
                setupMessageHandler();
                checkAnalysisStatus();
            }
        }
    } catch (error) {
        console.error('Ошибка восстановления состояния:', error);
    }
}

function setupMessageHandler() {
    if (currentMessageHandler) {
        chrome.runtime.onMessage.removeListener(currentMessageHandler);
    }
    
    currentMessageHandler = (request, sender, sendResponse) => {
        console.log('Получено сообщение:', request);
        
        if (request.analysisId !== currentAnalysisId) {
            return;
        }
        
        if (request.action === "analysisProgress") {
            console.log('Прогресс анализа:', request.message, request.progress);
            showProgress(request.message, request.progress);
            saveAnalysisState(request.message, request.progress, 'processing');
        }
        else if (request.action === "analysisComplete") {
            console.log('Анализ завершен:', request.result);
            handleAnalysisComplete(request.result);
        } else if (request.action === "analysisError") {
            console.log('Ошибка анализа:', request.error);
            handleAnalysisError(request.error);
        }
    };
    
    chrome.runtime.onMessage.addListener(currentMessageHandler);
    console.log('Обработчик сообщений установлен для анализа:', currentAnalysisId);
}

function checkAnalysisStatus() {
    console.log('Проверка статуса анализа:', currentAnalysisId);
    
    chrome.runtime.sendMessage({
        action: "getAnalysisStatus",
        analysisId: currentAnalysisId
    }, function(response) {
        if (chrome.runtime.lastError) {
            console.log('Background script недоступен:', chrome.runtime.lastError);
            handleAnalysisError('Сервис анализа недоступен');
            return;
        }
        
        console.log('Статус анализа:', response);
        
        if (response && response.analysis) {
            const analysis = response.analysis;
            if (analysis.status === 'completed' && analysis.result) {
                handleAnalysisComplete(analysis.result);
            } else if (analysis.status === 'error') {
                handleAnalysisError(analysis.error || 'Произошла ошибка анализа');
            } else if (analysis.status === 'processing') {
                showProgress(analysis.message || 'Анализ выполняется...', analysis.progress || 50);
            } else {
                handleAnalysisError('Неизвестный статус анализа: ' + analysis.status);
            }
        } else {
            handleAnalysisError('Анализ не найден или был прерван');
        }
    });
}

async function loadAnalysisFromHistory() {
    try {
        await loadAnalysisHistory();
        if (analysisHistory.length > 0) {
            const latestAnalysis = analysisHistory[0];
            if (latestAnalysis && Date.now() - new Date(latestAnalysis.timestamp).getTime() < 60000) {
                handleAnalysisComplete(latestAnalysis.result);
                return;
            }
        }
        handleAnalysisError('Результат анализа не найден');
    } catch (error) {
        handleAnalysisError('Не удалось загрузить результат анализа');
    }
}

function handleAnalysisComplete(result) {
    if (!currentAnalysisId) {
        console.log('Анализ был отменен, игнорируем результат');
        return;
    }
    
    hideProgress();
    displayAnalysisResult(result);
    showMessage('Анализ завершен!', 'success');
    clearAnalysisState();
    const analyzeTextInput = document.getElementById('analyzeText');
    if (analyzeTextInput) analyzeTextInput.value = '';
    const analyzeTextBtn = document.getElementById('analyzeTextBtn');
    if (analyzeTextBtn) {
        analyzeTextBtn.innerHTML = '<img src="pictures/text32.png" alt="Анализ текста" class="icon">\nАнализ текста';
        analyzeTextBtn.disabled = false;
    }
    const historyTab = document.querySelector('[data-tab="history"]');
    if (historyTab) historyTab.click();
    setTimeout(async () => {
        await loadAnalysisHistory();
        const historyListContainer = document.getElementById('historyListContainer');
        const historyReportContainer = document.getElementById('historyReportContainer');
        if (historyListContainer) historyListContainer.style.display = 'none';
        if (historyReportContainer) historyReportContainer.style.display = '';
        const reportDiv = document.getElementById('historyFullReport');
        if (reportDiv && analysisHistory.length > 0) {
            reportDiv.innerHTML = '';
            displayAnalysisResult(analysisHistory[0].result, reportDiv);
        }
    }, 200);
}

function handleAnalysisError(error) {
    if (error.includes('отменен') || error.includes('AbortError')) {
        console.log('Анализ был отменен пользователем');
        return;
    }
    
    hideProgress();
        let friendlyError = error;
        if (error && (error.includes('не найден') || error.includes('прерван'))) {
            friendlyError = 'Сервер перегружен или временно недоступен. Пожалуйста, попробуйте позже.';
        }
        showError(friendlyError);
    clearAnalysisState();
}

async function saveAnalysisState(message, progress, status = 'processing') {
    const text = document.getElementById('analyzeText').value;
    currentAnalysisState = {
        analysisId: currentAnalysisId,
        status: status,
        progress: progress,
        message: message,
        text: text.substring(0, 500),
        timestamp: Date.now()
    };
    
    await chrome.storage.local.set({ currentAnalysis: currentAnalysisState });
}

async function clearAnalysisState() {
    currentAnalysisState = null;
    currentAnalysisId = null;
    await chrome.storage.local.remove('currentAnalysis');
    
    if (currentMessageHandler) {
        chrome.runtime.onMessage.removeListener(currentMessageHandler);
        currentMessageHandler = null;
    }
}

async function refreshHistoryDisplay() {
    await loadAnalysisHistory();
    if (document.querySelector('[data-tab="history"]').classList.contains('active')) {
        displayAnalysisHistory();
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
                refreshHistoryDisplay();
            }
            if (tabName === 'analyzer') {
                const analysisResultDiv = document.getElementById('analysisResult');
                if (analysisResultDiv) {
                    analysisResultDiv.innerHTML = '<div class="message bot-message">Результаты проверки фактов появятся здесь...</div>';
                }
                const analyzeTextInput = document.getElementById('analyzeText');
                if (analyzeTextInput && !analyzeTextInput.value) analyzeTextInput.value = '';
                const analyzeTextBtn = document.getElementById('analyzeTextBtn');
                if (analyzeTextBtn) {
                    analyzeTextBtn.innerHTML = '<img src="pictures/text32.png" alt="Анализ текста" class="icon">\nАнализ текста';
                    analyzeTextBtn.disabled = false;
                }
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
        
        showProgress('Извлечение контента страницы...', 0);
        
        const results = await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            func: extractFullPageContent
        });
        
        if (results[0].result) {
            let pageContent = results[0].result;
            const maxLength = 4000;
            if (pageContent.length > maxLength) {
                pageContent = pageContent.substring(0, maxLength) + '... [текст обрезан]';
            }
            document.getElementById('analyzeText').value = pageContent;
            showProgress('Подготовка к анализу...', 30);
            await performAnalysis(pageContent, `Анализ страницы: ${tab.title}`);
        }
    } catch (error) {
        hideProgress();
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
    
    showProgress('Подготовка к анализу...', 10);
    
    await performAnalysis(text, 'Анализ текста');
}

async function performAnalysis(text, title = 'Анализ') {
    const analyzeBtn = document.getElementById('analyzeTextBtn');
    const originalBtnHTML = analyzeBtn.innerHTML;
    
    try {
        analyzeBtn.innerHTML = '<span class="loading"></span> Анализируем...';
        analyzeBtn.disabled = true;
        
        currentAnalysisId = 'analysis_' + Date.now();
        
        console.log('Запуск анализа с ID:', currentAnalysisId);
        
        await saveAnalysisState('Запуск анализа...', 10);
        
        setupMessageHandler();
        
        showProgress('Запуск анализа...', 10);
        
        chrome.runtime.sendMessage({
            action: "startAnalysis",
            text: text,
            title: title,
            analysisId: currentAnalysisId
        }, function(response) {
            if (chrome.runtime.lastError) {
                console.error('Ошибка отправки:', chrome.runtime.lastError);
                handleAnalysisError('Не удалось отправить запрос на анализ: ' + chrome.runtime.lastError.message);
                return;
            }
            
            console.log('Ответ от background:', response);
            
            if (response && response.success) {
                showProgress('Анализ запущен...', 20);
                saveAnalysisState('Анализ запущен...', 20, 'processing');
            } else {
                handleAnalysisError('Не удалось запустить анализ');
            }
        });
        
    } catch (error) {
        console.error('Ошибка в performAnalysis:', error);
        handleAnalysisError(error.message);
    } finally {
        setTimeout(() => {
            analyzeBtn.innerHTML = originalBtnHTML;
            analyzeBtn.disabled = false;
        }, 1000);
    }
}

function showProgress(message, progress) {
    let progressBar = document.getElementById('analysisProgress');
    
    if (!progressBar) {
        progressBar = document.createElement('div');
        progressBar.id = 'analysisProgress';
        progressBar.className = 'progress-overlay';
        progressBar.innerHTML = `
            <div class="progress-container">
                <div class="progress-text">${message}</div>
                <div class="progress-bar">
                    <div class="progress-fill" id="progressFill" style="width: ${progress}%"></div>
                </div>
                <div class="progress-percent" id="progressText">${progress}%</div>
                <button id="cancelAnalysis" style="margin-top: 10px; padding: 8px 16px; background: #ef4444; color: white; border: none; border-radius: 4px; cursor: pointer;">Отменить анализ</button>
            </div>
        `;
        
        progressBar.querySelector('#cancelAnalysis').addEventListener('click', cancelCurrentAnalysis);
        
        document.body.appendChild(progressBar);
    } else {
        const progressFill = document.getElementById('progressFill');
        const progressText = document.getElementById('progressText');
        const messageDiv = progressBar.querySelector('.progress-text');
        
        if (messageDiv) messageDiv.textContent = message;
        if (progressFill) progressFill.style.width = progress + '%';
        if (progressText) progressText.textContent = progress + '%';
    }
}

async function cancelCurrentAnalysis() {
    if (!currentAnalysisId) return;
    
    try {
        const response = await chrome.runtime.sendMessage({
            action: "cancelAnalysis",
            analysisId: currentAnalysisId
        });
        
        const analyzeTextBtn = document.getElementById('analyzeTextBtn');
        if (analyzeTextBtn) {
            analyzeTextBtn.innerHTML = '<img src="pictures/text32.png" alt="Анализ текста" class="icon">\nАнализ текста';
            analyzeTextBtn.disabled = false;
        }
        if (response && response.success) {
            hideProgress();
            clearAnalysisState();
            showMessage('Анализ успешно отменен', 'success');
            console.log('Анализ отменен:', currentAnalysisId);
        } else {
            showMessage('Не удалось отменить анализ', 'error');
        }
    } catch (error) {
        console.error('Ошибка при отмене анализа:', error);
        hideProgress();
        clearAnalysisState();
        const analyzeTextBtn = document.getElementById('analyzeTextBtn');
        if (analyzeTextBtn) {
            analyzeTextBtn.innerHTML = '<img src="pictures/text32.png" alt="Анализ текста" class="icon">\nАнализ текста';
            analyzeTextBtn.disabled = false;
        }
        showMessage('Анализ прерван', 'success');
    }
}

function hideProgress() {
    const progressBar = document.getElementById('analysisProgress');
    if (progressBar) {
        progressBar.remove();
    }
}

function displayAnalysisResult(result, customDiv) {
    const resultDiv = customDiv || document.getElementById('analysisResult');
    if (!resultDiv) return;
    resultDiv.innerHTML = '';
    
    const verdict = document.createElement('div');
    verdict.className = 'analysis-item';
    
    let verdictClass = 'verdict-warning';
    let verdictText = '';
    
    if (result.verdict === 'Правдивые') {
        verdictClass = 'verdict-true';
        verdictText = '✅ ПРАВДИВЫЕ НОВОСТИ';
    } else if (result.verdict === 'Недостоверные') {
        verdictClass = 'verdict-false';
        verdictText = '❌ НЕДОСТОВЕРНЫЕ НОВОСТИ';
    } else {
        verdictText = '⚠️ ЧАСТИЧНО ПРАВДИВЫЕ';
    }
    
    verdict.innerHTML = `
        <div class="verdict-header ${verdictClass}">${verdictText}</div>
        <div class="confidence-level">Уровень уверенности: ${result.confidence_level}</div>
        <div class="analysis-details">${result.summary}</div>
    `;
    resultDiv.appendChild(verdict);
    
    if (result.sources_validation) {
        const validationSection = document.createElement('div');
        validationSection.className = 'analysis-item';
        validationSection.innerHTML = `
            <div style="font-weight: 600; margin-bottom: 8px;">🔍 ПРОВЕРКА ИСТОЧНИКОВ:</div>
            <div class="analysis-details">
                <strong>Рабочих источников:</strong> ${result.sources_validation.working_sources || 0}<br>
                <strong>Нерабочих источников:</strong> ${result.sources_validation.broken_sources || 0}<br>
                <strong>Официальных источников:</strong> ${result.sources_validation.official_sources_count || 0}<br>
                <strong>Оценка перекрестной проверки:</strong> ${result.sources_validation.cross_verification_score || 0}/10
            </div>
        `;
        resultDiv.appendChild(validationSection);
    }
    
    if (result.fact_check && result.fact_check.verified_facts && result.fact_check.verified_facts.length > 0) {
        const verifiedSection = document.createElement('div');
        verifiedSection.className = 'analysis-item';
        verifiedSection.innerHTML = '<div style="font-weight: 600; margin-bottom: 8px;">✅ ПОДТВЕРЖДЕННЫЕ ФАКТЫ:</div>';
        
        result.fact_check.verified_facts.forEach((item, index) => {
            const factDiv = document.createElement('div');
            factDiv.className = 'fact-item verified';
            
            const factText = item.fact || item;
            const sourceText = item.source || 'Источник не указан';
            
            factDiv.innerHTML = `
                <strong>Факт ${index + 1}:</strong> ${factText}
                <br><small>📎 Источник: ${sourceText}</small>
            `;
            verifiedSection.appendChild(factDiv);
        });
        resultDiv.appendChild(verifiedSection);
    }
    
    if (result.fact_check && result.fact_check.false_claims && result.fact_check.false_claims.length > 0) {
        const falseSection = document.createElement('div');
        falseSection.className = 'analysis-item';
        falseSection.innerHTML = '<div style="font-weight: 600; margin-bottom: 8px;">❌ ОПРОВЕРГНУТЫЕ УТВЕРЖДЕНИЯ:</div>';
        
        result.fact_check.false_claims.forEach((item, index) => {
            const claimDiv = document.createElement('div');
            claimDiv.className = 'fact-item false';
            
            const claimText = item.claim || item;
            const sourceText = item.contradiction_source || 'Источник опровержения не указан';
            
            claimDiv.innerHTML = `
                <strong>Ложное утверждение ${index + 1}:</strong> ${claimText}
                <br><small>📎 Опровержение: ${sourceText}</small>
            `;
            falseSection.appendChild(claimDiv);
        });
        resultDiv.appendChild(falseSection);
    }
    
    if (result.fact_check && result.fact_check.unverified_claims && result.fact_check.unverified_claims.length > 0) {
        const unverifiedSection = document.createElement('div');
        unverifiedSection.className = 'analysis-item';
        unverifiedSection.innerHTML = '<div style="font-weight: 600; margin-bottom: 8px;">❓ НЕПОДТВЕРЖДЕННЫЕ УТВЕРЖДЕНИЯ:</div>';
        
        result.fact_check.unverified_claims.forEach((item, index) => {
            const claimDiv = document.createElement('div');
            claimDiv.className = 'fact-item unverified';
            
            const claimText = item.claim || item;
            const reasonText = item.reason || 'Причина непроверенности не указана';
            
            claimDiv.innerHTML = `
                <strong>Утверждение ${index + 1}:</strong> ${claimText}
                <br><small>📋 Причина: ${reasonText}</small>
            `;
            unverifiedSection.appendChild(claimDiv);
        });
        resultDiv.appendChild(unverifiedSection);
    }
    
    if (result.recommendations && result.recommendations.length > 0) {
        const recSection = document.createElement('div');
        recSection.className = 'analysis-item';
        recSection.innerHTML = '<div style="font-weight: 600; margin-bottom: 8px;">💡 РЕКОМЕНДАЦИИ:</div>';
        
        result.recommendations.forEach((rec, index) => {
            const recDiv = document.createElement('div');
            recDiv.className = 'analysis-details';
            recDiv.innerHTML = `${index + 1}. ${rec}`;
            recSection.appendChild(recDiv);
        });
        resultDiv.appendChild(recSection);
    }
    
    if (!hasProperSources(result)) {
        const warningSection = document.createElement('div');
        warningSection.className = 'analysis-item';
        warningSection.innerHTML = `
            <div style="font-weight: 600; margin-bottom: 8px; color: #f59e0b;">⚠️ ВНИМАНИЕ:</div>
            <div class="analysis-details">
                В анализе отсутствуют конкретные источники. Рекомендуется провести дополнительную проверку информации.
            </div>
        `;
        resultDiv.appendChild(warningSection);
    }
}

function hasProperSources(result) {
    if (!result.fact_check) return false;
    
    let hasSources = false;
    
    if (result.fact_check.verified_facts && result.fact_check.verified_facts.length > 0) {
        hasSources = result.fact_check.verified_facts.some(fact => {
            const source = fact.source || (typeof fact === 'string' ? null : fact.source);
            return source && source !== 'Источник не указан' && source !== 'Источник не указан в анализе';
        });
    }
    
    return hasSources;
}

function displayAnalysisHistory() {
    const historyList = document.getElementById('historyList');
    historyList.innerHTML = '';
    const historyListContainer = document.getElementById('historyListContainer');
    const historyReportContainer = document.getElementById('historyReportContainer');
    if (historyReportContainer) historyReportContainer.style.display = 'none';
    if (historyListContainer) historyListContainer.style.display = '';

    if (analysisHistory.length === 0) {
        historyList.innerHTML = '<div class="message bot-message">История анализов пуста</div>';
        return;
    }

    analysisHistory.forEach((item, index) => {
        const historyItem = document.createElement('div');
        historyItem.className = 'history-item';

        let verdictIcon = '❓';
        if (item.result.verdict === 'Правдивые') verdictIcon = '✅';
        if (item.result.verdict === 'Недостоверные') verdictIcon = '❌';

        let analyzedInfo = '';
        if (item.url) {
            analyzedInfo = `<span style="color:#60a5fa;font-size:12px;word-break:break-all;">${item.url}</span>`;
        } else if (item.text) {
            let shortText = item.text.trim().replace(/\s+/g, ' ');
            if (shortText.length > 60) shortText = shortText.slice(0, 60) + '...';
            analyzedInfo = `<span style="color:#a3a3a3;font-size:12px;">${shortText}</span>`;
        }

        historyItem.innerHTML = `
            <div style="font-weight: 600; margin-bottom: 4px;">${verdictIcon} ${item.title}</div>
            <div style="font-size: 12px; opacity: 0.7; margin-bottom: 2px;">
                ${new Date(item.timestamp).toLocaleString()}
            </div>
            ${analyzedInfo ? `<div style=\"margin-bottom:4px;\">${analyzedInfo}</div>` : ''}
            <div style="font-size: 12px; opacity: 0.8;">
                Вердикт: ${item.result.verdict} (${item.result.confidence_level})
            </div>
        `;
        historyItem.addEventListener('click', () => {
            if (historyListContainer) historyListContainer.style.display = 'none';
            if (historyReportContainer) historyReportContainer.style.display = '';
            const reportDiv = document.getElementById('historyFullReport');
            if (reportDiv) {
                reportDiv.innerHTML = '';
                displayAnalysisResult(item.result, reportDiv);
            }
        });
        historyList.appendChild(historyItem);
    });
    setTimeout(() => {
        const backBtn = document.getElementById('backToHistory');
        if (backBtn) {
            backBtn.onclick = function() {
                if (historyReportContainer) historyReportContainer.style.display = 'none';
                if (historyListContainer) historyListContainer.style.display = '';
            };
        }
    }, 0);
}

async function loadAnalysisHistory() {
    const result = await chrome.storage.local.get(['analysisHistory']);
    analysisHistory = result.analysisHistory || [];
}

async function clearAnalysisHistory() {
    if (confirm('Очистить всю историю анализов?')) {
        analysisHistory = [];
        await chrome.storage.local.set({ analysisHistory: [] });
        displayAnalysisHistory();
        showMessage('История очищена', 'success');
    }
}

function exportHistory() {
    if (analysisHistory.length === 0) {
        showMessage('Нет данных для экспорта', 'error');
        return;
    }
    
    let txt = `VacLive — История анализов\nЭкспорт: ${new Date().toLocaleString()}\n\n`;
    analysisHistory.forEach((item, idx) => {
        txt += `Анализ #${idx+1}\n`;
        txt += `Дата: ${new Date(item.timestamp).toLocaleString()}\n`;
        txt += `Заголовок: ${item.title || '-'}\n`;
        txt += `Вердикт: ${item.result.verdict || '-'} (уверенность: ${item.result.confidence_level || '-'})\n`;
        if (item.text) txt += `Текст: ${item.text}\n`;
        if (item.result.fact_check) {
            if (item.result.fact_check.verified_facts?.length) {
                txt += `\n✔ Проверенные факты:\n`;
                item.result.fact_check.verified_facts.forEach(f => {
                    txt += `- ${f.fact}`;
                    if (f.source) txt += ` (источник: ${f.source})`;
                    txt += '\n';
                });
            }
            if (item.result.fact_check.false_claims?.length) {
                txt += `\n✖ Ложные утверждения:\n`;
                item.result.fact_check.false_claims.forEach(f => {
                    txt += `- ${f.claim}`;
                    if (f.contradiction_source) txt += ` (обоснование: ${f.contradiction_source})`;
                    txt += '\n';
                });
            }
            if (item.result.fact_check.unverified_claims?.length) {
                txt += `\n? Неподтверждённые утверждения:\n`;
                item.result.fact_check.unverified_claims.forEach(f => {
                    txt += `- ${f.claim}`;
                    if (f.reason) txt += ` (причина: ${f.reason})`;
                    txt += '\n';
                });
            }
        }
        if (item.result.recommendations?.length) {
            txt += `\nРекомендации:\n`;
            item.result.recommendations.forEach(r => {
                txt += `- ${r}\n`;
            });
        }
        txt += `\n${'-'.repeat(40)}\n\n`;
    });
    const blob = new Blob([txt], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `VacLive-history-${new Date().toISOString().split('T')[0]}.txt`;
    a.click();
    URL.revokeObjectURL(url);
}

async function loadChatHistory() {
    const result = await chrome.storage.local.get(['chatHistory']);
    chatHistory = result.chatHistory || [];
    displayChatHistory();
}

function markdownToHtml(md) {
    if (!md) return '';
    let html = md;
    html = html.replace(/```([\s\S]*?)```/g, '<pre><code>$1</code></pre>');
    html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
    html = html.replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');
    html = html.replace(/__([^_]+)__/g, '<b>$1</b>');
    html = html.replace(/\*([^*]+)\*/g, '<i>$1</i>');
    html = html.replace(/_([^_]+)_/g, '<i>$1</i>');
    html = html.replace(/~~([^~]+)~~/g, '<del>$1</del>');
    html = html.replace(/==([^=]+)==/g, '<u>$1</u>');
    html = html.replace(/\^\(([^)]+)\)/g, '<sup>$1</sup>');
    html = html.replace(/~\(([^)]+)\)/g, '<sub>$1</sub>');
    html = html.replace(/^>\s?(.*)$/gm, '<blockquote>$1</blockquote>');
    html = html.replace(/^(\d+)\. (.*)$/gm, '<li>$2</li>');
    html = html.replace(/(<li>.*<\/li>)/gs, '<ol>$1</ol>');
    html = html.replace(/^\s*[-*+] (.*)$/gm, '<li>$1</li>');
    html = html.replace(/(<li>.*<\/li>)/gs, '<ul>$1</ul>');
    html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank">$1</a>');
    html = html.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img alt="$1" src="$2" style="max-width:100%;max-height:200px;">');
    html = html.replace(/^###### (.*)$/gm, '<h6>$1</h6>');
    html = html.replace(/^##### (.*)$/gm, '<h5>$1</h5>');
    html = html.replace(/^#### (.*)$/gm, '<h4>$1</h4>');
    html = html.replace(/^### (.*)$/gm, '<h3>$1</h3>');
    html = html.replace(/^## (.*)$/gm, '<h2>$1</h2>');
    html = html.replace(/^# (.*)$/gm, '<h1>$1</h1>');
    html = html.replace(/\n/g, '<br>');
    return html;
}

function displayChatHistory() {
    const messagesDiv = document.getElementById('messages');
    messagesDiv.innerHTML = '';
    if (chatHistory.length === 0) {
        const welcomeMessage = document.createElement('div');
        welcomeMessage.className = 'message bot-message';
        welcomeMessage.innerHTML = 'Привет! Я ваш AI помощник для проверки фактов. Чем могу помочь?';
        messagesDiv.appendChild(welcomeMessage);
        return;
    }
    chatHistory.forEach(item => {
        const messageDiv = document.createElement('div');
        messageDiv.className = `message ${item.role === 'user' ? 'user-message' : 'bot-message'}`;
        if (item.role === 'assistant') {
            messageDiv.innerHTML = markdownToHtml(item.content);
        } else {
            messageDiv.textContent = item.content;
        }
        messagesDiv.appendChild(messageDiv);
    });
    messagesDiv.scrollTop = messagesDiv.scrollHeight;
}

async function sendMessage() {
    const input = document.getElementById('userInput');
    const message = input.value.trim();
    if (!message) return;
    const userMessage = { role: 'user', content: message };
    chatHistory.push(userMessage);
    input.value = '';
    displayChatHistory();
    const loadingDiv = document.createElement('div');
    loadingDiv.className = 'message bot-message';
    loadingDiv.innerHTML = '<div class="loading"></div> Думаю...';
    document.getElementById('messages').appendChild(loadingDiv);
    await chrome.storage.local.set({ pendingUserMessage: message });
    const apiKey = await getApiKey();
    const validKey = 'sk-04f0f810450346fcb0c73748baa2fadf';
    if (!apiKey || apiKey !== validKey) {
        loadingDiv.remove();
        chatHistory.pop();
        const errorMessage = { role: 'assistant', content: '❌ Ошибка: Неверный API ключ. Введите корректный ключ в настройках.' };
        chatHistory.push(errorMessage);
        displayChatHistory();
        await chrome.storage.local.remove(['pendingUserMessage', 'pendingBotResponse']);
        return;
    }
    try {
        await chrome.runtime.sendMessage({
            action: 'sendChatMessage',
            history: chatHistory
        });
    } catch (error) {
        loadingDiv.remove();
        chatHistory.pop();
        const errorMessage = { role: 'assistant', content: `❌ Ошибка: ${error.message}` };
        chatHistory.push(errorMessage);
        displayChatHistory();
        await chrome.storage.local.remove(['pendingUserMessage', 'pendingBotResponse']);
        console.error('Ошибка отправки сообщения (background):', error);
    }
}

async function restoreChatState() {
    await loadChatHistory();
    const result = await chrome.storage.local.get(['pendingUserMessage', 'pendingBotResponse']);
    if (result.pendingUserMessage && !result.pendingBotResponse) {
        const userMessage = { role: 'user', content: result.pendingUserMessage };
        if (!chatHistory.length || chatHistory[chatHistory.length-1].content !== userMessage.content) {
            chatHistory.push(userMessage);
        }
        displayChatHistory();
        const messagesDiv = document.getElementById('messages');
        if (!messagesDiv.querySelector('.loading')) {
            const loadingDiv = document.createElement('div');
            loadingDiv.className = 'message bot-message';
            loadingDiv.innerHTML = '<div class="loading"></div> Думаю...';
            messagesDiv.appendChild(loadingDiv);
        }
        resendPendingMessage(result.pendingUserMessage);
    }
}

async function resendPendingMessage(message) {
    try {
        const apiKey = await getApiKey();
        if (!apiKey) throw new Error('API ключ не найден. Сохраните ключ в настройках.');
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
        if (!response.ok) {
            let shortMsg = `Ошибка API: ${response.status}`;
            try {
                const err = await response.json();
                if (response.status === 401 || (err.error && (err.error.type === 'authentication_error' || err.error.code === 'invalid_api_key'))) {
                    shortMsg = 'Ошибка: Неверный API ключ';
                }
            } catch {}
            throw new Error(shortMsg);
        }
        const data = await response.json();
        const botMessage = data.choices[0].message.content;
        const messagesDiv = document.getElementById('messages');
        const loadingDiv = messagesDiv.querySelector('.loading')?.parentElement;
        if (loadingDiv) loadingDiv.remove();
        const botMessageObj = { role: 'assistant', content: botMessage };
        chatHistory.push(botMessageObj);
        displayChatHistory();
        if (chatHistory.length > 50) chatHistory = chatHistory.slice(-25);
        await chrome.storage.local.set({ chatHistory });
        await chrome.storage.local.remove(['pendingUserMessage', 'pendingBotResponse']);
    } catch (error) {
        const messagesDiv = document.getElementById('messages');
        const loadingDiv = messagesDiv.querySelector('.loading')?.parentElement;
        if (loadingDiv) loadingDiv.remove();
        chatHistory.pop();
        const errorMessage = { role: 'assistant', content: `❌ Ошибка: ${error.message}` };
        chatHistory.push(errorMessage);
        displayChatHistory();
        await chrome.storage.local.remove(['pendingUserMessage', 'pendingBotResponse']);
        console.error('Ошибка отправки сообщения:', error);
    }
}

async function saveApiKey() {
    const apiKey = document.getElementById('apiKey').value.trim();
    const validKey = 'sk-04f0f810450346fcb0c73748baa2fadf';
    if (!apiKey) {
        showError('Введите API ключ');
        return;
    }
    if (apiKey !== validKey) {
        showError('Неверный API ключ!');
        return;
    }
    try {
        await chrome.storage.local.set({ deepseekApiKey: apiKey });
        document.getElementById('apiSection').style.display = 'none';
        document.getElementById('menuBtn').style.display = '';
        showMessage('API ключ сохранен', 'success');
    } catch (error) {
        showError('Ошибка при сохранении ключа');
    }
}

async function clearAllData() {
    if (confirm('Вы уверены? Это удалит все данные, включая историю анализов и чата.')) {
        await chrome.storage.local.clear();
        analysisHistory = [];
        chatHistory = [];
        if (document.getElementById('analyzeText')) document.getElementById('analyzeText').value = '';
        if (document.getElementById('analysisResult')) document.getElementById('analysisResult').innerHTML = '';
        if (document.getElementById('historyList')) document.getElementById('historyList').innerHTML = '';
        if (document.getElementById('messages')) document.getElementById('messages').innerHTML = '';
        if (document.getElementById('apiKey')) document.getElementById('apiKey').value = '';
        currentTheme = 'light';
        document.body.setAttribute('data-theme', 'light');
        await chrome.storage.local.set({ theme: 'light' });
        if (document.getElementById('apiSection')) document.getElementById('apiSection').style.display = 'none';
        if (document.getElementById('menuBtn')) document.getElementById('menuBtn').style.display = '';
        showMessage('Все данные очищены', 'success');
        displayChatHistory();
    }
}

async function loadSettings() {
    const result = await chrome.storage.local.get(['theme', 'deepseekApiKey']);
    currentTheme = result.theme || 'light';
    document.body.setAttribute('data-theme', currentTheme);
    
    if (result.deepseekApiKey) {
        document.getElementById('apiKey').value = result.deepseekApiKey;
        document.getElementById('apiSection').style.display = 'none';
        document.getElementById('menuBtn').style.display = '';
    } else {
        document.getElementById('apiSection').style.display = '';
        document.getElementById('menuBtn').style.display = 'none';
    }
}

function showMessage(message, type) {
    const messageDiv = document.createElement('div');
    messageDiv.className = type === 'error' ? 'error-message' : 'success-message';
    messageDiv.textContent = message;
    messageDiv.style.cssText = `
        position: fixed;
        top: 20px;
        left: 50%;
        transform: translateX(-50%);
        z-index: 10000;
        padding: 12px 20px;
        border-radius: 8px;
        font-weight: 500;
        max-width: 90%;
        text-align: center;
    `;
    
    document.body.appendChild(messageDiv);
    
    setTimeout(() => {
        if (messageDiv.parentNode) {
            messageDiv.parentNode.removeChild(messageDiv);
        }
    }, 3000);
}

function showError(message) {
    showMessage(message, 'error');
}

async function getApiKey() {
    const result = await chrome.storage.local.get(['deepseekApiKey']);
    return result.deepseekApiKey;
}