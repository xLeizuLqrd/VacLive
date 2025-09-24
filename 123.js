const CONFIG = {
    MAX_TEXT_LENGTH: 8000,
    MAX_FILE_SIZE: 5 * 1024 * 1024, // 5MB
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

// Глобальные переменные
let currentTheme = 'light';
let analysisHistory = [];
let currentAttachments = [];

// Инициализация
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
    
    // Файловые обработчики
    document.getElementById('fileUploadBtn').addEventListener('click', () => {
        document.getElementById('fileInput').click();
    });
    
    document.getElementById('fileInput').addEventListener('change', handleFileSelect);
    
    document.getElementById('analyzeTextBtn').addEventListener('click', analyzeTextHandler);
    document.getElementById('analyzePage').addEventListener('click', analyzeCurrentPage);
    
    document.getElementById('saveKey').addEventListener('click', saveApiKey);
    document.getElementById('clearData').addEventListener('click', clearAllData);
    document.getElementById('clearHistory').addEventListener('click', clearAnalysisHistory);
    document.getElementById('exportHistory').addEventListener('click', exportHistory);
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
            
            // Убираем активный класс у всех вкладок
            tabs.forEach(t => t.classList.remove('active'));
            tabContents.forEach(tc => tc.classList.remove('active'));
            
            // Добавляем активный класс к выбранной вкладке
            tab.classList.add('active');
            document.getElementById(`${tabName}-tab`).classList.add('active');
            
            // Анимируем перемещение индикатора
            moveIndicator();
            
            // Загружаем историю если нужно
            if (tabName === 'history') {
                displayAnalysisHistory();
            }
        });
    });

    // Обновляем индикатор при изменении размера окна
    window.addEventListener('resize', moveIndicator);
    
    // Инициализируем позицию индикатора
    setTimeout(moveIndicator, 100);
}

async function toggleTheme() {
    currentTheme = currentTheme === 'light' ? 'dark' : 'light';
    document.body.setAttribute('data-theme', currentTheme);
    await chrome.storage.local.set({ theme: currentTheme });
}

async function handleFileSelect(event) {
    const files = Array.from(event.target.files);
    
    for (const file of files) {
        if (file.size > CONFIG.MAX_FILE_SIZE) {
            showError(`Файл "${file.name}" слишком большой. Максимальный размер: 5MB`);
            continue;
        }
        
        // Проверяем тип файла
        const validTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/jpg', 'image/webp', 
                           'application/pdf', 'text/plain', 'text/csv', 'text/html',
                           'application/msword', 
                           'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
                           'application/vnd.ms-excel',
                           'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'];
        
        if (!validTypes.includes(file.type) && !file.name.match(/\.(txt|pdf|doc|docx|xls|xlsx|csv|html)$/i)) {
            showError(`Неподдерживаемый тип файла: ${file.name}`);
            continue;
        }
        
        // Добавляем файл в текущие вложения
        if (!currentAttachments.some(att => att.name === file.name && att.size === file.size)) {
            // Читаем содержимое текстовых файлов
            if (file.type.startsWith('text/') || file.name.match(/\.(txt|csv|html)$/i)) {
                try {
                    const content = await readTextFile(file);
                    file.textContent = content.substring(0, CONFIG.MAX_TEXT_LENGTH);
                } catch (error) {
                    console.error('Ошибка чтения файла:', error);
                    file.textContent = '[Не удалось прочитать содержимое файла]';
                }
            }
            
            // Для PDF и DOCX пытаемся извлечь текст
            if (file.type === 'application/pdf' || file.name.match(/\.(pdf|doc|docx|xls|xlsx)$/i)) {
                try {
                    const content = await extractTextFromFile(file);
                    file.textContent = content.substring(0, CONFIG.MAX_TEXT_LENGTH);
                } catch (error) {
                    console.error('Ошибка извлечения текста:', error);
                    file.textContent = '[Содержимое недоступно для анализа]';
                }
            }
            
            // Сохраняем файл как base64 для последующего восстановления
            try {
                file.base64 = await fileToBase64(file);
            } catch (error) {
                console.error('Ошибка конвертации файла в base64:', error);
            }
            
            currentAttachments.push(file);
        }
    }
    
    updateAttachmentsPreview();
    event.target.value = '';
}

// Функция конвертации файла в base64
function fileToBase64(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result.split(',')[1]);
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
}

// Функция восстановления файла из base64
function base64ToFile(base64, filename, mimeType) {
    const byteCharacters = atob(base64);
    const byteArrays = [];
    
    for (let offset = 0; offset < byteCharacters.length; offset += 512) {
        const slice = byteCharacters.slice(offset, offset + 512);
        const byteNumbers = new Array(slice.length);
        
        for (let i = 0; i < slice.length; i++) {
            byteNumbers[i] = slice.charCodeAt(i);
        }
        
        const byteArray = new Uint8Array(byteNumbers);
        byteArrays.push(byteArray);
    }
    
    const blob = new Blob(byteArrays, { type: mimeType });
    blob.name = filename;
    return blob;
}

// Функция чтения текстовых файлов
function readTextFile(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => resolve(e.target.result);
        reader.onerror = (e) => reject(e);
        reader.readAsText(file, 'UTF-8');
    });
}

// Функция извлечения текста из различных форматов
async function extractTextFromFile(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        
        reader.onload = function(e) {
            try {
                const data = e.target.result;
                
                if (file.type === 'application/pdf' || file.name.endsWith('.pdf')) {
                    // Базовая попытка извлечь текст из PDF
                    resolve(extractTextFromPDF(data));
                } else if (file.name.match(/\.(doc|docx)$/i)) {
                    // Для DOC/DOCX - простой парсинг
                    resolve(extractTextFromDOC(data));
                } else if (file.name.match(/\.(xls|xlsx)$/i)) {
                    // Для Excel - простой парсинг
                    resolve(extractTextFromExcel(data));
                } else {
                    resolve('Содержимое файла недоступно для анализа');
                }
            } catch (error) {
                reject(error);
            }
        };
        
        reader.onerror = reject;
        
        if (file.type === 'application/pdf' || file.name.endsWith('.pdf')) {
            reader.readAsArrayBuffer(file);
        } else {
            reader.readAsText(file, 'UTF-8');
        }
    });
}

// Упрощенные функции извлечения текста
function extractTextFromPDF(data) {
    // Базовая попытка найти текст в PDF
    const uint8Array = new Uint8Array(data);
    const textDecoder = new TextDecoder('utf-8');
    const pdfText = textDecoder.decode(uint8Array);
    
    // Упрощенный парсинг PDF - ищем текстовые блоки
    const textMatches = pdfText.match(/\(([^)]+)\)/g);
    if (textMatches) {
        return textMatches.map(match => match.slice(1, -1)).join(' ')
                         .replace(/\\n/g, ' ')
                         .replace(/\s+/g, ' ')
                         .trim();
    }
    
    return 'Текст из PDF недоступен для автоматического извлечения';
}

function extractTextFromDOC(data) {
    // Упрощенный парсинг DOC/DOCX - ищем текстовые участки
    return data.replace(/<[^>]*>/g, ' ') // Удаляем HTML теги
              .replace(/[^\w\sа-яА-ЯёЁ.,!?;:()-]/g, ' ') // Оставляем только текст и пунктуацию
              .replace(/\s+/g, ' ')
              .trim();
}

function extractTextFromExcel(data) {
    // Упрощенный парсинг Excel - ищем табличные данные
    return data.split('\n')
              .map(line => line.split('\t').join(' | '))
              .join('\n')
              .substring(0, CONFIG.MAX_TEXT_LENGTH);
}

function updateAttachmentsPreview() {
    const previewContainer = document.getElementById('attachmentsPreview');
    
    if (currentAttachments.length === 0) {
        previewContainer.style.display = 'none';
        previewContainer.innerHTML = '';
        return;
    }
    
    previewContainer.style.display = 'flex';
    previewContainer.innerHTML = '';
    
    currentAttachments.forEach((file, index) => {
        const attachmentItem = document.createElement('div');
        attachmentItem.className = 'attachment-item';
        
        const fileIcon = getFileIcon(file.type);
        const fileSize = formatFileSize(file.size);
        const hasContent = file.textContent && file.textContent !== '[Содержимое недоступно для анализа]';
        
        attachmentItem.innerHTML = `
            <span>${fileIcon} ${hasContent ? '📖' : ''}</span>
            <span style="max-width: 120px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" 
                  title="${file.name}">${file.name}</span>
            <span style="color: var(--text-secondary); font-size: 10px;">${fileSize}</span>
            <button class="remove-attachment" data-index="${index}">×</button>
        `;
        
        previewContainer.appendChild(attachmentItem);
    });
    
    // Добавляем обработчики для кнопок удаления
    previewContainer.querySelectorAll('.remove-attachment').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const index = parseInt(e.target.getAttribute('data-index'));
            currentAttachments.splice(index, 1);
            updateAttachmentsPreview();
        });
    });
}

function getFileIcon(fileType) {
    if (fileType.startsWith('image/')) return '🖼️';
    if (fileType === 'application/pdf') return '📄';
    if (fileType.includes('word')) return '📝';
    if (fileType.includes('excel') || fileType.includes('spreadsheet')) return '📊';
    if (fileType.startsWith('text/') || fileType === 'text/plain') return '📃';
    if (fileType === 'text/html') return '🌐';
    if (fileType === 'text/csv') return '📋';
    return '📎';
}

function formatFileSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
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
            messages: [{ role: 'user', content: prompt }],
            max_tokens: 2500,
            temperature: 0.3
        })
    });
    
    if (!response.ok) {
        throw new Error(`Ошибка API: ${response.status}`);
    }
    
    const data = await response.json();
    return parseAnalysisResult(data.choices[0].message.content);
}

function parseAnalysisResult(result) {
    try {
        const jsonMatch = result.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
            return JSON.parse(jsonMatch[0]);
        }
        throw new Error('Неверный формат ответа от AI');
    } catch (error) {
        console.error('Ошибка парсинга:', error);
        return createDefaultAnalysisResult();
    }
}

function createDefaultAnalysisResult() {
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
        summary: "Произошла ошибка при анализе текста",
        recommendations: ["Попробуйте проанализировать другой текст"]
    };
}

function displayAnalysisResult(result) {
    const resultDiv = document.getElementById('analysisResult');
    resultDiv.innerHTML = '';
    
    // Вердикт с цветом
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
    
    // Валидация источников
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
    
    // Проверенные факты с статусом источников
    if (result.fact_check.verified_facts && result.fact_check.verified_facts.length > 0) {
        const verifiedSection = document.createElement('div');
        verifiedSection.className = 'analysis-item';
        verifiedSection.innerHTML = '<div style="font-weight: 600; margin-bottom: 8px;">✅ ПОДТВЕРЖДЕННЫЕ ФАКТЫ:</div>';
        
        result.fact_check.verified_facts.forEach((item, index) => {
            const factDiv = document.createElement('div');
            factDiv.className = 'fact-item verified';
            
            const statusIcon = item.source_status === 'рабочий' ? '🟢' : '🟡';
            const matchLevel = item.content_match === 'полное' ? '✅' : 
                              item.content_match === 'частичное' ? '⚠️' : '❌';
            
            factDiv.innerHTML = `
                <strong>Факт ${index + 1}:</strong> ${item.fact}
                <br><small>${statusIcon} Источник: <a href="${item.source}" target="_blank" style="color: #666; text-decoration: underline;">${item.source}</a></small>
                <br><small>${matchLevel} Соответствие: ${item.content_match}</small>
            `;
            verifiedSection.appendChild(factDiv);
        });
        resultDiv.appendChild(verifiedSection);
    }
    
    // Ложные утверждения
    if (result.fact_check.false_claims && result.fact_check.false_claims.length > 0) {
        const falseSection = document.createElement('div');
        falseSection.className = 'analysis-item';
        falseSection.innerHTML = '<div style="font-weight: 600; margin-bottom: 8px;">❌ ОПРОВЕРГНУТЫЕ УТВЕРЖДЕНИЯ:</div>';
        
        result.fact_check.false_claims.forEach((item, index) => {
            const claimDiv = document.createElement('div');
            claimDiv.className = 'fact-item false';
            
            const statusIcon = item.source_status === 'рабочий' ? '🟢' : '🟡';
            
            claimDiv.innerHTML = `
                <strong>Ложное утверждение ${index + 1}:</strong> ${item.claim}
                <br><small>${statusIcon} Опровержение: <a href="${item.contradiction_source}" target="_blank" style="color: #666; text-decoration: underline;">${item.contradiction_source}</a></small>
                <br><small>📋 Тип опровержения: ${item.contradiction_type}</small>
            `;
            falseSection.appendChild(claimDiv);
        });
        resultDiv.appendChild(falseSection);
    }
    
    // Неподтвержденные утверждения
    if (result.fact_check.unverified_claims && result.fact_check.unverified_claims.length > 0) {
        const unverifiedSection = document.createElement('div');
        unverifiedSection.className = 'analysis-item';
        unverifiedSection.innerHTML = '<div style="font-weight: 600; margin-bottom: 8px;">❓ НЕПОДТВЕРЖДЕННЫЕ УТВЕРЖДЕНИЯ:</div>';
        
        result.fact_check.unverified_claims.forEach((item, index) => {
            const claimDiv = document.createElement('div');
            claimDiv.className = 'fact-item unverified';
            
            claimDiv.innerHTML = `
                <strong>Утверждение ${index + 1}:</strong> ${item.claim}
                <br><small>📋 Причина: ${item.reason}</small>
                ${item.attempted_sources && item.attempted_sources.length > 0 ? 
                    `<br><small>🔍 Проверенные источники: ${item.attempted_sources.join(', ')}</small>` : ''}
            `;
            unverifiedSection.appendChild(claimDiv);
        });
        resultDiv.appendChild(unverifiedSection);
    }
    
    // Рекомендации
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
}

async function saveToAnalysisHistory(analysis) {
    analysisHistory.unshift(analysis);
    if (analysisHistory.length > 50) {
        analysisHistory = analysisHistory.slice(0, 50);
    }
    await chrome.storage.local.set({ analysisHistory });
}

function displayAnalysisHistory() {
    const historyList = document.getElementById('historyList');
    historyList.innerHTML = '';
    
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
        
        historyItem.innerHTML = `
            <div style="font-weight: 600; margin-bottom: 4px;">${verdictIcon} ${item.title}</div>
            <div style="font-size: 12px; opacity: 0.7; margin-bottom: 4px;">
                ${new Date(item.timestamp).toLocaleString()}
            </div>
            <div style="font-size: 12px; opacity: 0.8;">
                Вердикт: ${item.result.verdict} (${item.result.confidence_level})
            </div>
        `;
        historyItem.addEventListener('click', () => {
            displayAnalysisResult(item.result);
            document.querySelector('[data-tab="analyzer"]').click();
        });
        historyList.appendChild(historyItem);
    });
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
    
    const exportData = {
        exportDate: new Date().toISOString(),
        analyses: analysisHistory
    };
    
    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `factcheck-history-${new Date().toISOString().split('T')[0]}.json`;
    a.click();
    URL.revokeObjectURL(url);
    
    showMessage('История экспортирована', 'success');
}

async function getApiKey() {
    const result = await chrome.storage.local.get(['deepseekApiKey']);
    return result.deepseekApiKey;
}

async function loadSettings() {
    const result = await chrome.storage.local.get(['deepseekApiKey', 'theme', 'chatHistory']);
    
    if (result.deepseekApiKey) {
        document.getElementById('apiKey').value = result.deepseekApiKey;
        document.getElementById('apiSection').style.display = 'none';
        document.getElementById('menuBtn').style.display = '';
    } else {
        document.getElementById('apiSection').style.display = '';
        document.getElementById('menuBtn').style.display = 'none';
    }
    
    if (result.theme) {
        currentTheme = result.theme;
        document.body.setAttribute('data-theme', currentTheme);
    }
    
    if (result.chatHistory) {
        loadChatHistory(result.chatHistory);
    }
}

async function saveApiKey() {
    const apiKey = document.getElementById('apiKey').value.trim();
    if (!apiKey) {
        showError('Введите API ключ');
        return;
    }
    
    await chrome.storage.local.set({ deepseekApiKey: apiKey });
    showMessage('API ключ сохранен!', 'success');
    document.getElementById('apiSection').style.display = 'none';
    document.getElementById('menuBtn').style.display = '';
    document.getElementById('menuPopup').style.display = 'none';
}

async function clearAllData() {
    if (confirm('Очистить все данные (ключ, историю чата, анализы)?')) {
        await chrome.storage.local.clear();
        analysisHistory = [];
        currentAttachments = [];
        document.getElementById('apiKey').value = '';
        document.getElementById('messages').innerHTML = 
            '<div class="message bot-message">Привет! Я ваш AI помощник для проверки фактов. Чем могу помочь?</div>';
        document.getElementById('analysisResult').innerHTML = 
            '<div class="message bot-message">Результаты проверки фактов появятся здесь...</div>';
        updateAttachmentsPreview();
        displayAnalysisHistory();
        showMessage('Все данные очищены', 'success');
    }
}

async function sendMessage() {
    const userInput = document.getElementById('userInput');
    const message = userInput.value.trim();
    
    if (!message && currentAttachments.length === 0) return;
    
    // Сохраняем сообщение с вложениями в историю
    await saveMessageToHistory(message, currentAttachments, true);
    
    // Добавляем сообщение с вложениями в чат
    addMessageWithAttachments(message, currentAttachments, true);
    userInput.value = '';
    
    try {
        const thinkingMsg = addMessage('Думаю...', false);
        
        // Передаем сообщение и историю в API
        const response = await sendToDeepSeek(message, currentAttachments);
        
        thinkingMsg.remove();
        addMessage(response, false);
        
        // Сохраняем ответ бота в историю
        await saveMessageToHistory(response, [], false);
        
        // Очищаем вложения после отправки
        currentAttachments = [];
        updateAttachmentsPreview();
        
    } catch (error) {
        const messages = document.getElementById('messages');
        const lastMessage = messages.lastElementChild;
        if (lastMessage && lastMessage.textContent === 'Думаю...') {
            lastMessage.remove();
        }
        addMessage(`❌ Ошибка: ${error.message}`, false);
        await saveMessageToHistory(`❌ Ошибка: ${error.message}`, [], false);
    }
}

async function sendToDeepSeek(message, attachments = []) {
    const apiKey = await getApiKey();
    if (!apiKey) {
        throw new Error('API ключ не найден. Сохраните ключ в настройках.');
    }
    
    // Получаем историю сообщений
    const result = await chrome.storage.local.get(['chatHistory']);
    const chatHistory = result.chatHistory || [];
    
    // Формируем массив сообщений для API
    const messages = [];
    
    // Добавляем историю сообщений (последние 10 сообщений для экономии токенов)
    const recentHistory = chatHistory.slice(-10);
    recentHistory.forEach(msg => {
        // Пропускаем сообщения об ошибках и системные сообщения
        if (!msg.text.includes('❌ Ошибка:') && msg.text !== 'Думаю...') {
            messages.push({
                role: msg.isUser ? 'user' : 'assistant',
                content: formatMessageContent(msg.text, msg.attachments)
            });
        }
    });
    
    // Добавляем текущее сообщение
    messages.push({
        role: 'user',
        content: formatMessageContent(message, attachments)
    });
    
    const response = await fetch('https://api.deepseek.com/v1/chat/completions', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify({
            model: 'deepseek-chat',
            messages: messages,
            max_tokens: 4000,
            temperature: 0.7
        })
    });
    
    if (!response.ok) {
        throw new Error(`Ошибка API: ${response.status}`);
    }
    
    const data = await response.json();
    return data.choices[0].message.content;
}

// Вспомогательная функция для форматирования сообщений с вложениями
function formatMessageContent(text, attachments = []) {
    let content = text;
    
    if (attachments.length > 0) {
        const attachmentsContent = [];
        
        for (const file of attachments) {
            if (file.textContent && file.textContent !== '[Содержимое недоступно для анализа]') {
                attachmentsContent.push(
                    `СОДЕРЖИМОЕ ФАЙЛА "${file.name}":\n${file.textContent}`
                );
            } else {
                attachmentsContent.push(
                    `ФАЙЛ: ${file.name} (${formatFileSize(file.size)}) - содержимое недоступно для анализа`
                );
            }
        }
        
        if (attachmentsContent.length > 0) {
            content += '\n\n' + attachmentsContent.join('\n\n');
        }
    }
    
    return content;
}

function addMessageWithAttachments(text, attachments = [], isUser = false) {
    const messagesDiv = document.getElementById('messages');
    const messageContainer = document.createElement('div');
    messageContainer.className = `message ${isUser ? 'user-message' : 'bot-message'}`;
    
    // Добавляем текст сообщения
    if (text) {
        const textDiv = document.createElement('div');
        textDiv.textContent = text;
        messageContainer.appendChild(textDiv);
    }
    
    // Добавляем вложения
    if (attachments.length > 0) {
        attachments.forEach(file => {
            const fileDiv = document.createElement('div');
            fileDiv.className = 'message-file';
            fileDiv.fileObj = file; // Сохраняем ссылку на объект файла
            
            const fileLink = document.createElement('a');
            fileLink.className = 'file-preview';
            fileLink.href = URL.createObjectURL(file);
            fileLink.target = '_blank';
            fileLink.download = file.name;
            
            const fileIcon = getFileIcon(file.type);
            const fileSize = formatFileSize(file.size);
            const hasContent = file.textContent && file.textContent !== '[Содержимое недоступно для анализа]';
            
            fileLink.innerHTML = `
                <span class="file-icon">${fileIcon} ${hasContent ? ' ' : ''}</span>
                <div class="file-info">
                    <div class="file-name">${file.name}</div>
                    <div class="file-size">${fileSize}</div>
                </div>
            `;
            
            fileDiv.appendChild(fileLink);
            messageContainer.appendChild(fileDiv);
        });
    }
    
    messagesDiv.appendChild(messageContainer);
    messagesDiv.scrollTop = messagesDiv.scrollHeight;
    
    return messageContainer;
}

function addMessage(text, isUser = false) {
    const messagesDiv = document.getElementById('messages');
    const messageDiv = document.createElement('div');
    messageDiv.className = `message ${isUser ? 'user-message' : 'bot-message'}`;
    
    if (isUser) {
        messageDiv.textContent = text;
    } else {
        // Преобразование markdown в html для бота
        let html = text;
        // Заголовки ###, ##, #
        html = html.replace(/^### (.*)$/gm, '<h3>$1</h3>');
        html = html.replace(/^## (.*)$/gm, '<h2>$1</h2>');
        html = html.replace(/^# (.*)$/gm, '<h1>$1</h1>');
        // Жирный **text**
        html = html.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
        // Курсив *text*
        html = html.replace(/\*(?!\*)([^\*]+)\*/g, '<i>$1</i>');
        // Списки (строки, начинающиеся с *)
        if (/^\s*\* /m.test(html)) {
            html = html.replace(/^(\s*)\* (.+)$/gm, '$1<li>$2</li>');
            // Оборачиваем группы <li> в <ul>
            html = html.replace(/((?:<li>.*?<\/li>\s*)+)/gs, '<ul>$1</ul>');
        }
        // Переводы строк в <br>, кроме внутри <ul>
        html = html.replace(/([^>])\n/g, '$1<br>');
        messageDiv.innerHTML = html;
    }
    
    messagesDiv.appendChild(messageDiv);
    messagesDiv.scrollTop = messagesDiv.scrollHeight;
    return messageDiv;
}

async function saveMessageToHistory(text, attachments = [], isUser = false) {
    const result = await chrome.storage.local.get(['chatHistory']);
    const chatHistory = result.chatHistory || [];
    
    // Подготавливаем вложения для сохранения
    const savedAttachments = [];
    for (const file of attachments) {
        const attachment = {
            name: file.name,
            size: file.size,
            type: file.type,
            textContent: file.textContent,
            base64: file.base64 // Сохраняем base64 для восстановления
        };
        savedAttachments.push(attachment);
    }
    
    // Добавляем новое сообщение
    chatHistory.push({
        text: text,
        isUser: isUser,
        attachments: savedAttachments,
        timestamp: new Date().toISOString()
    });
    
    // Ограничиваем историю последними 20 сообщениями (для экономии токенов)
    if (chatHistory.length > 20) {
        chatHistory.splice(0, chatHistory.length - 20);
    }
    
    await chrome.storage.local.set({ chatHistory });
}

function loadChatHistory(history) {
    const messagesDiv = document.getElementById('messages');
    messagesDiv.innerHTML = '';

    history.forEach(msg => {
        if (msg.text !== 'Думаю...') {
            if (msg.attachments && msg.attachments.length > 0) {
                // Восстанавливаем файлы из base64
                const files = msg.attachments.map(att => {
                    if (att.base64) {
                        try {
                            const file = base64ToFile(att.base64, att.name, att.type);
                            file.textContent = att.textContent;
                            file.base64 = att.base64; // Сохраняем для будущего использования
                            return file;
                        } catch (error) {
                            console.error('Ошибка восстановления файла:', error);
                            return null;
                        }
                    }
                    return null;
                }).filter(Boolean);
                
                addMessageWithAttachments(msg.text, files, msg.isUser);
            } else {
                addMessage(msg.text, msg.isUser);
            }
        }
    });
}

function showError(message) {
    showMessage(message, 'error');
}

function showMessage(message, type = 'info') {
    const messageDiv = document.createElement('div');
    messageDiv.className = type === 'error' ? 'error-message' : 'success-message';
    messageDiv.textContent = message;
    
    document.querySelector('.container').insertBefore(messageDiv, document.querySelector('.tabs-container'));
    
    setTimeout(() => {
        messageDiv.remove();
    }, 3000);
}