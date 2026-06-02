// Запрашиваем у бэкграунда самую свежую версию кода, скачанную с GitHub
chrome.runtime.sendMessage({ action: "getLatestCode" }, (response) => {
    if (response && response.code) {
        // Запускаем код через безопасную инъекцию в контекст страницы
        const script = document.createElement('script');
        script.textContent = response.code;
        (document.head || document.documentElement).appendChild(script);
        script.remove();
    } else {
        console.log("Свежий код с GitHub не найден, ждем загрузки...");
    }
});