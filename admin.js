class AdminPanel {
    constructor() {
        this.stats = {};
        this.charts = {};
        this.currentTheme = 'light';
        this.init();
        this.setupLogButton();
    }

    async init() {
        await this.setupTheme();
        this.setupEventListeners();
        await this.loadStats();
        this.renderCharts();
    }

    setupLogButton() {
        // Гарантированно навешиваем обработчики после загрузки DOM
        window.addEventListener('DOMContentLoaded', () => {
            const logBtn = document.getElementById('viewLogBtn');
            const logModal = document.getElementById('logModal');
            const closeBtn = document.getElementById('closeLogModal');
            const logContent = document.getElementById('logContent');
            if (logBtn && logModal && closeBtn && logContent) {
                logBtn.addEventListener('click', async () => {
                    logModal.style.display = 'flex';
                    logContent.textContent = 'Загрузка...';
                    try {
                        const result = await chrome.storage.local.get(['logFile']);
                        logContent.textContent = result.logFile || 'Лог пуст.';
                    } catch (e) {
                        logContent.textContent = 'Ошибка загрузки лога.';
                    }
                });
                closeBtn.addEventListener('click', () => {
                    logModal.style.display = 'none';
                });
            }
        });
    }

    setupEventListeners() {
        document.getElementById('refreshBtn').addEventListener('click', () => this.refreshData());
        document.getElementById('themeToggle').addEventListener('click', () => this.toggleTheme());
        document.getElementById('exportJSON').addEventListener('click', () => this.exportData('json'));
        document.getElementById('exportCSV').addEventListener('click', () => this.exportData('csv'));
        document.getElementById('clearStats').addEventListener('click', () => this.clearStats());
    }

    async setupTheme() {
        try {
            const result = await chrome.storage.local.get(['adminTheme']);
            this.currentTheme = result.adminTheme || 'light';
            this.applyTheme(this.currentTheme);
        } catch (error) {
            console.error('Ошибка загрузки темы:', error);
            this.applyTheme('light');
        }
    }

    applyTheme(theme) {
        this.currentTheme = theme;
        document.body.setAttribute('data-theme', theme);
        
        const themeIcon = document.getElementById('themeIcon');
        const themeText = document.getElementById('themeText');
        
        if (theme === 'dark') {
            themeIcon.textContent = '☀️';
            themeText.textContent = 'Светлая тема';
        } else {
            themeIcon.textContent = '🌙';
            themeText.textContent = 'Тёмная тема';
        }
        
        chrome.storage.local.set({ adminTheme: theme });
    }

    toggleTheme() {
        const newTheme = this.currentTheme === 'light' ? 'dark' : 'light';
        this.applyTheme(newTheme);
        
        setTimeout(() => {
            this.refreshCharts();
        }, 100);
    }

    async loadStats() {
        try {
            const response = await new Promise((resolve) => {
                chrome.runtime.sendMessage({ action: "getUsageStatistics" }, resolve);
            });
            
            if (response && response.success) {
                this.stats = response.statistics;
                this.renderStats();
                this.updateLastUpdateTime();
            } else {
                throw new Error('Не удалось загрузить статистику');
            }
        } catch (error) {
            console.error('Ошибка загрузки статистики:', error);
            const result = await chrome.storage.local.get(['usageStatistics']);
            this.stats = result.usageStatistics || this.getDefaultStats();
            this.renderStats();
        }
    }

    getDefaultStats() {
        const defaultDate = new Date().toISOString().split('T')[0];
        return {
            totalRequests: 0,
            totalTokens: 0,
            totalUsers: 0,
            errorCount: 0,
            startDate: defaultDate,
            dailyStats: {},
            functionStats: {
                chat: { count: 0, tokens: 0, totalTime: 0 },
                analysis: { count: 0, tokens: 0, totalTime: 0 },
                contextMenu: { count: 0, tokens: 0, totalTime: 0 }
            },
            recentRequests: [],
            lastUpdate: Date.now()
        };
    }

    updateLastUpdateTime() {
        const lastUpdateElement = document.getElementById('lastUpdateTime');
        if (lastUpdateElement && this.stats.lastUpdate) {
            const date = new Date(this.stats.lastUpdate);
            lastUpdateElement.textContent = date.toLocaleString('ru-RU');
        }
    }

    renderStats() {
        this.renderMainStats();
        this.renderRecentRequests();
        this.renderFunctionStats();
        this.renderSourceCheck();
    }

    renderSourceCheck() {
        // Найти контейнер блока проверки источников
        const block = document.querySelector('.stat-card.source-check');
        if (!block) return;
        // Получить оценку из статистики
        let score = this.stats.crossCheckScore;
        if (typeof score !== 'number') score = 0;
        // Ограничить диапазон
        score = Math.max(1, Math.min(10, Math.round(score)));
        // Найти элемент для вывода
        const scoreEl = block.querySelector('.cross-check-score');
        if (scoreEl) scoreEl.textContent = score;
    }

    renderMainStats() {
        const today = new Date().toISOString().split('T')[0];
        const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];
        
        const todayStats = this.stats.dailyStats && this.stats.dailyStats[today] ? 
            this.stats.dailyStats[today] : { requests: 0, tokens: 0, errors: 0 };
        const yesterdayStats = this.stats.dailyStats && this.stats.dailyStats[yesterday] ? 
            this.stats.dailyStats[yesterday] : { requests: 0, tokens: 0, errors: 0 };

        document.getElementById('totalRequests').textContent = (this.stats.totalRequests || 0).toLocaleString();
        document.getElementById('totalTokens').textContent = Math.round(this.stats.totalTokens || 0).toLocaleString();
        document.getElementById('activeUsers').textContent = this.stats.totalUsers || 0;
        document.getElementById('errorRate').textContent = this.calculateErrorRate() + '%';

        this.renderTrend('requestsTrend', todayStats.requests, yesterdayStats.requests, 'запросов');
        this.renderTrend('tokensTrend', todayStats.tokens, yesterdayStats.tokens, 'токенов');
        this.renderTrend('usersTrend', this.stats.totalUsers || 0, this.stats.totalUsers || 0, 'пользователей');
        this.renderTrend('errorsTrend', todayStats.errors, yesterdayStats.errors, 'ошибок', true);
    }

    calculateErrorRate() {
        if (!this.stats.totalRequests || this.stats.totalRequests === 0) return 0;
        const errorCount = this.stats.errorCount || 0;
        return ((errorCount / this.stats.totalRequests) * 100).toFixed(1);
    }

    renderTrend(elementId, today, yesterday, label, inverse = false) {
        const element = document.getElementById(elementId);
        const diff = (today || 0) - (yesterday || 0);
        
        let trendClass = 'trend-same';
        let trendIcon = '→';
        let trendText = 'Без изменений';
        
        if (diff > 0) {
            trendClass = inverse ? 'trend-down' : 'trend-up';
            trendIcon = '↗';
            trendText = `+${Math.abs(diff)} ${label}`;
        } else if (diff < 0) {
            trendClass = inverse ? 'trend-up' : 'trend-down';
            trendIcon = '↘';
            trendText = `-${Math.abs(diff)} ${label}`;
        }
        
        element.innerHTML = `<span class="${trendClass}">${trendIcon} ${trendText}</span>`;
    }

    renderRecentRequests() {
        const tbody = document.getElementById('recentRequestsBody');
        const recentRequests = this.stats.recentRequests ? 
            this.stats.recentRequests.slice(-10).reverse() : [];
        
        if (recentRequests.length === 0) {
            tbody.innerHTML = '<tr><td colspan="4" style="text-align: center; color: var(--text-tertiary); padding: 40px;">Нет данных о запросах</td></tr>';
            return;
        }
        
        tbody.innerHTML = recentRequests.map(request => `
            <tr>
                <td>${this.formatTime(request.timestamp)}</td>
                <td><span class="badge badge-${request.status === 'success' ? 'success' : 'error'}">${this.formatFunctionName(request.type)}</span></td>
                <td>${Math.round(request.tokens || 0)}</td>
                <td>${request.status === 'success' ? '✅' : '❌'}</td>
            </tr>
        `).join('');
    }

    renderFunctionStats() {
        const tbody = document.getElementById('functionsBody');
        const functionStats = this.stats.functionStats || {};
        
        if (!functionStats || Object.keys(functionStats).length === 0) {
            tbody.innerHTML = '<tr><td colspan="4" style="text-align: center; color: var(--text-tertiary); padding: 40px;">Нет данных по функциям</td></tr>';
            return;
        }
        
        tbody.innerHTML = Object.entries(functionStats).map(([func, stats]) => {
            const avgTime = stats.count > 0 ? Math.round((stats.totalTime || 0) / stats.count) : 0;
            return `
            <tr>
                <td><strong>${this.formatFunctionName(func)}</strong></td>
                <td>${stats.count || 0}</td>
                <td>${Math.round(stats.tokens || 0)}</td>
                <td>${avgTime > 0 ? avgTime + 'мс' : '-'}</td>
            </tr>
        `}).join('');
    }

    formatFunctionName(func) {
        const names = {
            chat: '💬 Чат',
            analysis: '🔍 Анализ',
            contextMenu: '📋 Контекстное меню'
        };
        return names[func] || func;
    }

    formatTime(timestamp) {
        return new Date(timestamp).toLocaleString('ru-RU', {
            day: '2-digit',
            month: '2-digit',
            hour: '2-digit',
            minute: '2-digit'
        });
    }

    renderCharts() {
        this.renderRequestsChart();
        this.renderTypesChart();
    }

    refreshCharts() {
        if (this.charts.requests) {
            this.charts.requests.destroy();
        }
        if (this.charts.types) {
            this.charts.types.destroy();
        }
        this.renderCharts();
    }

    renderRequestsChart() {
        const chartCanvas = document.getElementById('requestsChart');
        if (!chartCanvas) return;
        const ctx = chartCanvas.getContext('2d');
        // Попробуем взять статистику по часам за последние сутки
        const hourlyStats = this.stats.hourlyStats || {};
        // Если нет hourlyStats, fallback на минутные (minuteStats)
        let labels = [];
        let requestsData = [];
        let tokensData = [];
        if (Object.keys(hourlyStats).length > 0) {
            // Формат ключа: 'YYYY-MM-DD HH'
            const sortedHours = Object.keys(hourlyStats).sort();
            labels = sortedHours.map(h => h.slice(-2) + ':00');
            requestsData = sortedHours.map(h => hourlyStats[h].requests || 0);
            tokensData = sortedHours.map(h => Math.round(hourlyStats[h].tokens || 0));
        } else if (this.stats.minuteStats && Object.keys(this.stats.minuteStats).length > 0) {
            // Формат ключа: 'YYYY-MM-DD HH:mm'
            const sortedMinutes = Object.keys(this.stats.minuteStats).sort();
            labels = sortedMinutes.map(m => m.slice(-5));
            requestsData = sortedMinutes.map(m => this.stats.minuteStats[m].requests || 0);
            tokensData = sortedMinutes.map(m => Math.round(this.stats.minuteStats[m].tokens || 0));
        } else {
            chartCanvas.parentNode.innerHTML = '<div style="color:#64748b; text-align:center; padding:60px 0; font-size:18px;">Нет данных для отображения</div>';
            return;
        }
        const isEmpty = requestsData.every(v => v === 0) && tokensData.every(v => v === 0);
        if (isEmpty) {
            chartCanvas.parentNode.innerHTML = '<div style="color:#64748b; text-align:center; padding:60px 0; font-size:18px;">Нет данных для отображения</div>';
            return;
        }
        const isDark = this.currentTheme === 'dark';
        const gridColor = isDark ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.1)';
        const textColor = isDark ? '#cbd5e1' : '#64748b';
        this.charts.requests = new Chart(ctx, {
            type: 'line',
            data: {
                labels: labels,
                datasets: [
                    {
                        label: 'Запросы',
                        data: requestsData,
                        borderColor: '#2563eb',
                        backgroundColor: 'rgba(37, 99, 235, 0.1)',
                        tension: 0.4,
                        yAxisID: 'y',
                        fill: true
                    },
                    {
                        label: 'Токены',
                        data: tokensData,
                        borderColor: '#10b981',
                        backgroundColor: 'rgba(16, 185, 129, 0.1)',
                        tension: 0.4,
                        yAxisID: 'y1',
                        fill: true
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: {
                    mode: 'index',
                    intersect: false,
                },
                scales: {
                    x: {
                        grid: {
                            color: gridColor
                        },
                        ticks: {
                            color: textColor
                        }
                    },
                    y: {
                        type: 'linear',
                        display: true,
                        position: 'left',
                        grid: {
                            color: gridColor
                        },
                        ticks: {
                            color: textColor
                        },
                        title: {
                            display: true,
                            text: 'Запросы',
                            color: textColor
                        }
                    },
                    y1: {
                        type: 'linear',
                        display: true,
                        position: 'right',
                        grid: {
                            drawOnChartArea: false,
                        },
                        ticks: {
                            color: textColor
                        },
                        title: {
                            display: true,
                            text: 'Токены',
                            color: textColor
                        }
                    }
                },
                plugins: {
                    legend: {
                        position: 'top',
                        labels: {
                            color: textColor
                        }
                    }
                }
            }
        });
    }

    renderTypesChart() {
        const chartCanvas = document.getElementById('typesChart');
        if (!chartCanvas) return;
        const ctx = chartCanvas.getContext('2d');
        const functionStats = this.stats.functionStats || {};
        const labels = Object.keys(functionStats).map(key => this.formatFunctionName(key));
        const data = Object.values(functionStats).map(stats => stats.count || 0);
        const isEmpty = data.every(val => val === 0);
        if (isEmpty) {
            chartCanvas.parentNode.innerHTML = '<div style="color:#64748b; text-align:center; padding:60px 0; font-size:18px;">Нет данных для отображения</div>';
            return;
        }
        const isDark = this.currentTheme === 'dark';
        const textColor = isDark ? '#cbd5e1' : '#64748b';
        const gridColor = isDark ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.1)';
        this.charts.types = new Chart(ctx, {
            type: 'doughnut',
            data: {
                labels: labels,
                datasets: [{
                    data: data,
                    backgroundColor: [
                        'rgba(37, 99, 235, 0.8)',
                        'rgba(16, 185, 129, 0.8)',
                        'rgba(245, 158, 11, 0.8)',
                        'rgba(239, 68, 68, 0.8)',
                        'rgba(139, 92, 246, 0.8)',
                        'rgba(14, 165, 233, 0.8)'
                    ],
                    borderColor: [
                        '#2563eb',
                        '#10b981',
                        '#f59e0b',
                        '#ef4444',
                        '#8b5cf6',
                        '#0ea5e9'
                    ],
                    borderWidth: 2
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        position: 'bottom',
                        labels: {
                            color: textColor,
                            padding: 20,
                            usePointStyle: true
                        }
                    }
                }
            }
        });
    }

    getLastNDays(n) {
        const days = [];
        for (let i = n - 1; i >= 0; i--) {
            const date = new Date();
            date.setDate(date.getDate() - i);
            days.push(date.toISOString().split('T')[0]);
        }
        return days;
    }

    formatChartDate(dateString) {
        const date = new Date(dateString);
        return date.toLocaleDateString('ru-RU', { 
            day: 'numeric', 
            month: 'short' 
        }).replace(' г.', '');
    }

    async refreshData() {
        const refreshBtn = document.getElementById('refreshBtn');
        const originalHtml = refreshBtn.innerHTML;

        refreshBtn.innerHTML = '<span>⏳</span><span>Загрузка...</span>';
        refreshBtn.disabled = true;

        let finished = false;
        let success = false;
    // ...existing code...
        // Таймаут на случай зависания
        const timeout = setTimeout(() => {
            if (!finished) {
                refreshBtn.innerHTML = originalHtml;
                refreshBtn.disabled = false;
                this.showMessage('Ошибка: превышено время ожидания ответа', 'error');
            }
        }, 10000); // 10 секунд

        try {
            await this.loadStats();
            this.refreshCharts();
            success = true;
        } catch (error) {
            console.error('Ошибка при обновлении данных:', error);
        } finally {
            finished = true;
            clearTimeout(timeout);
            refreshBtn.innerHTML = originalHtml;
            refreshBtn.disabled = false;
            if (success) {
                this.showMessage('Данные успешно обновлены', 'success');
            }
        }
    }

    async exportData(format) {
        try {
            const data = this.prepareExportData();
            let content, mimeType, extension;
            
            if (format === 'json') {
                content = JSON.stringify(data, null, 2);
                mimeType = 'application/json';
                extension = 'json';
            } else {
                content = this.convertToCSV(data);
                mimeType = 'text/csv';
                extension = 'csv';
            }
            
            const blob = new Blob([content], { type: mimeType });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `vaclive-stats-${new Date().toISOString().split('T')[0]}.${extension}`;
            a.click();
            URL.revokeObjectURL(url);
            
            this.showMessage(`Данные экспортированы в ${format.toUpperCase()}`, 'success');
        } catch (error) {
            this.showMessage('Ошибка экспорта данных', 'error');
        }
    }

    prepareExportData() {
        return {
            exportDate: new Date().toISOString(),
            statistics: this.stats,
            summary: {
                totalRequests: this.stats.totalRequests || 0,
                totalTokens: Math.round(this.stats.totalTokens || 0),
                activeUsers: this.stats.totalUsers || 0,
                errorRate: this.calculateErrorRate(),
                period: `${this.stats.startDate || new Date().toISOString().split('T')[0]} - ${new Date().toISOString().split('T')[0]}`
            }
        };
    }

    convertToCSV(data) {
        const headers = ['Показатель', 'Значение'];
        const rows = [
            ['Всего запросов', data.summary.totalRequests],
            ['Всего токенов', data.summary.totalTokens],
            ['Активных пользователей', data.summary.activeUsers],
            ['Уровень ошибок', data.summary.errorRate + '%'],
            ['Период', data.summary.period],
            ['', ''],
            ['Функция', 'Запросы', 'Токены', 'Среднее время (мс)']
        ];

        Object.entries(data.statistics.functionStats || {}).forEach(([func, stats]) => {
            const avgTime = stats.count > 0 ? Math.round((stats.totalTime || 0) / stats.count) : 0;
            rows.push([
                this.formatFunctionName(func).replace(/[^\w\s]/gi, ''),
                stats.count || 0,
                Math.round(stats.tokens || 0),
                avgTime
            ]);
        });

        return rows.map(row => row.map(cell => `"${cell}"`).join(',')).join('\n');
    }

    async clearStats() {
        if (confirm('Вы уверены, что хотите очистить всю статистику? Это действие нельзя отменить.')) {
            try {
                const defaultStats = this.getDefaultStats();
                await chrome.storage.local.set({ usageStatistics: defaultStats });
                this.stats = defaultStats;
                this.renderStats();
                this.refreshCharts();
                this.showMessage('Статистика успешно очищена', 'success');
            } catch (error) {
                this.showMessage('Ошибка очистки статистики', 'error');
            }
        }
    }

    showMessage(message, type) {
        const existingMessages = document.querySelectorAll('.admin-message');
        existingMessages.forEach(msg => msg.remove());
        
        const messageDiv = document.createElement('div');
        messageDiv.className = 'admin-message';
        messageDiv.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            padding: 12px 20px;
            background: ${type === 'success' ? '#10b981' : '#ef4444'};
            color: white;
            border-radius: 8px;
            z-index: 1000;
            font-weight: 500;
            box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
            animation: slideInRight 0.3s ease-out;
        `;
        
        const style = document.createElement('style');
        style.textContent = `
            @keyframes slideInRight {
                from {
                    transform: translateX(100%);
                    opacity: 0;
                }
                to {
                    transform: translateX(0);
                    opacity: 1;
                }
            }
        `;
        document.head.appendChild(style);
        
        messageDiv.textContent = message;
        document.body.appendChild(messageDiv);
        
        setTimeout(() => {
            if (messageDiv.parentNode) {
                messageDiv.parentNode.removeChild(messageDiv);
            }
            if (style.parentNode) {
                style.parentNode.removeChild(style);
            }
        }, 3000);
    }
}

document.addEventListener('DOMContentLoaded', () => {
    new AdminPanel();
});