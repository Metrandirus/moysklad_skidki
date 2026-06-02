// Адрес твоего файла content.js на GitHub (используем raw-ссылку)
// ЗАМЕНИ ЮЗЕРНЕЙМ И РЕПОЗИТОРИЙ НА СВОИ, КОГДА ЗАЛЬЕШЬ НА ГИТХАБ
const GITHUB_RAW_URL = "https://raw.githubusercontent.com/Metrandirus/moysklad_skidki/refs/heads/main/moysklad_helper_backup.json";

// Проверяем обновления при старте Chrome или раз в 30 минут
chrome.runtime.onInstalled.addListener(updateCodeFromGithub);
chrome.runtime.onStartup.addListener(updateCodeFromGithub);

async function updateCodeFromGithub() {
    try {
        const response = await fetch(GITHUB_RAW_URL);
        if (!response.ok) return;
        const freshCode = await response.text();
        
        // Сохраняем свежий код в локальную память расширения
        await chrome.storage.local.set({ cachedContentJs: freshCode, lastUpdate: Date.now() });
        console.log("Код расширения успешно обновлен с GitHub!");
    } catch (e) {
        console.log("Не удалось скачать код с GitHub, работаем на старой копии", e);
    }
}

// Слушаем запросы от страниц МоегоСклада и отдаем им свежий код
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "getLatestCode") {
        chrome.storage.local.get(["cachedContentJs"], (data) => {
            sendResponse({ code: data.cachedContentJs || null });
        });
        return true; // Важно для асинхронного ответа
    }
});