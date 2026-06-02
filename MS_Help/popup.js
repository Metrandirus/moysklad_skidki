// --- ГЛОБАЛЬНЫЕ ПЕРЕМЕННЫЕ ДЛЯ МОДАЛКИ VIP ---
let localVipArray = [];        // Список всех VIP клиентов [{name: "Имя", rules: "строка скидок"}]
let currentVipRulesArray = []; // Скидки открытого в данный момент клиента [{brand: "Odeon", discount: 45}]
let activeEditIndex = null;    // Индекс редактируемого клиента в localVipArray

document.addEventListener('DOMContentLoaded', () => {
    // 1. ЗАГРУЗКА ДАННЫХ ИЗ ПАМЯТИ БРАУЗЕРА ПРИ ОТКРЫТИИ
    chrome.storage.local.get(['brandRules', 'dropRules', 'vipRules', 'githubUrl', 'githubToken'], (data) => {
        if (data.brandRules) document.getElementById('brandRules').value = data.brandRules;
        if (data.dropRules) document.getElementById('dropRules').value = data.dropRules;
        if (data.githubUrl) document.getElementById('githubUrl').value = data.githubUrl;
        if (data.githubToken) document.getElementById('githubToken').value = data.githubToken;
        if (data.vipRules) parseVipRules(data.vipRules);
        renderVipList();
    });

    // 2. ЖИВОЙ ПОИСК И УМНАЯ ФИЛЬТРАЦИЯ БРЕНДОВ В МОДАЛКЕ
    document.getElementById('brandSearchInput').addEventListener('input', (e) => {
        const query = e.target.value.trim().toLowerCase();
        const textarea = document.getElementById('modalRules');
        const status = document.getElementById('searchStatus');
        
        // Если поисковая строка пустая — выводим абсолютно все бренды этого VIP-клиента
        if (!query) {
            textarea.value = currentVipRulesArray.map(r => `${r.brand}: ${r.discount}`).join(',\n');
            status.innerText = "";
            textarea.disabled = false;
            return;
        }

        // Фильтруем изолированный глобальный массив брендов
        const filtered = currentVipRulesArray.filter(item => item.brand.toLowerCase().includes(query));

        if (filtered.length > 0) {
            // Отображаем на экране только совпадения
            textarea.value = filtered.map(r => `${r.brand}: ${r.discount}`).join(',\n');
            status.innerText = `🎯 Найдено брендов: ${filtered.length}`;
            textarea.disabled = false; // Разрешаем редактировать найденное
        } else {
            textarea.value = "";
            status.innerText = "❌ Брендов с таким названием не найдено";
            textarea.disabled = true;  // Блокируем поле, раз вводить нечего
        }
    });

    // 3. ОТСЛЕЖИВАНИЕ ИЗМЕНЕНИЙ СКИДОК В ПОЛЕ (ПРИ ЛЮБОМ РЕЖИМЕ ПОИСКА)
    document.getElementById('modalRules').addEventListener('input', (e) => {
        const text = e.target.value;
        
        // Разбираем строки, которые пользователь сейчас видит и редактирует на экране
        text.split('\n').forEach(line => {
            const cleanLine = line.replace(',', '').trim();
            if (!cleanLine.includes(':')) return;
            
            const [b, s] = cleanLine.split(':');
            if (b && s) {
                const bName = b.trim();
                const discountVal = parseInt(s.trim()) || 0;
                
                // Находим этот бренд в нашем эталонном массиве и обновляем ему скидку
                const mainRef = currentVipRulesArray.find(item => item.brand.toLowerCase() === bName.toLowerCase());
                if (mainRef) {
                    mainRef.discount = discountVal;
                }
            }
        });
    });

    // 4. КНОПКА «ПРИМЕНИТЬ» В МОДАЛКЕ VIP
    document.getElementById('modalSave').addEventListener('click', () => {
        if (activeEditIndex !== null) {
            // Собираем весь наш обновленный глобальный массив обратно в красивую строку через запятую
            const finalString = currentVipRulesArray.map(r => `${r.brand}: ${r.discount}`).join(', ');
            
            // Записываем её в локальную память этого VIP клиента
            localVipArray[activeEditIndex].rules = finalString;

            document.getElementById('modal').style.display = 'none';
            activeEditIndex = null;
            renderVipList();
        }
    });

    // Кнопка закрытия модалки без сохранения
    document.getElementById('modalClose').addEventListener('click', () => { 
        document.getElementById('modal').style.display = 'none'; 
        activeEditIndex = null;
    });

    // 5. КНОПКА: ДОБАВИТЬ НОВОГО VIP КЛИЕНТА В СПИСОК
    document.getElementById('addVipBtn').addEventListener('click', () => {
        const name = prompt("Введите имя VIP контрагента (точно как в МойСклад):");
        if (name && name.trim()) {
            localVipArray.push({ name: name.trim(), rules: "Odeon Light: 45, Maytoni: 45" });
            renderVipList();
        }
    });

    // 6. КНОПКА: СОХРАНИТЬ ВСЕ НАСТРОЙКИ ЛОКАЛЬНО НА ЭТОМ ПК
    document.getElementById('saveAll').addEventListener('click', saveAllToStorage);

    // 7. ОБЛАКО: СКАЧАТЬ АКТУАЛЬНЫЕ НАСТРОЙКИ ИЗ GITHUB
    document.getElementById('cloudPullBtn').addEventListener('click', () => {
        const url = document.getElementById('githubUrl').value.trim();
        if (!url) return alert('❌ Сначала введите GitHub Raw URL');
        
        const btn = document.getElementById('cloudPullBtn');
        btn.innerText = '⏳ Загрузка...'; btn.disabled = true;

        fetch(url + '?nocache=' + new Date().getTime())
            .then(res => { if (!res.ok) throw new Error(); return res.json(); })
            .then(remoteData => {
                document.getElementById('brandRules').value = remoteData.brandRules || "";
                document.getElementById('dropRules').value = remoteData.dropRules || "";
                
                localVipArray = []; 
                parseVipRules(remoteData.vipRules || "");
                renderVipList();
                
                chrome.storage.local.set({ 
                    brandRules: remoteData.brandRules, 
                    dropRules: remoteData.dropRules, 
                    vipRules: remoteData.vipRules, 
                    githubUrl: url 
                }, () => alert('📥 Настройки успешно обновлены из Облака у всех коллег!'));
            })
            .catch(() => alert('❌ Ошибка скачивания файла с GitHub. Проверьте URL.'))
            .finally(() => { btn.innerText = '📥 Получить из Облака'; btn.disabled = false; });
    });

    // 8. ОБЛАКО: УМНАЯ ОТПРАВКА НА GITHUB С АВТОМАТИЧЕСКИМ MERGE (БЕЗ ЗАТИРАНИЯ)
    document.getElementById('cloudPushBtn').addEventListener('click', async () => {
        const rawUrl = document.getElementById('githubUrl').value.trim();
        const token = document.getElementById('githubToken').value.trim();
        if (!rawUrl || !token) return alert('❌ Для отправки необходимы и Ссылка, и Секретный токен!');

        const btn = document.getElementById('cloudPushBtn');
        btn.innerText = '⏳ Синхронизация и merge...'; btn.disabled = true;

        try {
            // Трансформируем Raw URL в API URL для работы с GitHub API
            let apiUrl = rawUrl.replace('raw.githubusercontent.com', 'api.github.com/repos')
                               .replace('/refs/heads/', '/contents/')
                               .replace('/main/', '/contents/')
                               .replace('/master/', '/contents/');
            apiUrl = apiUrl.replace(/\/contents\/[^\/]+\//, '/contents/');

            // Данные, которые сейчас введены на текущем компьютере
            const localBrandText = document.getElementById('brandRules').value.trim();
            const localDropText = document.getElementById('dropRules').value.trim();
            
            // Шаг A: Получаем самый свежий файл и его SHA напрямую с сервера GitHub
            const fileCheck = await fetch(apiUrl, { 
                headers: { 'Authorization': `token ${token}` },
                cache: 'no-store' // Свежие данные, никакого кэша
            });
            
            let remoteData = { brandRules: "", dropRules: "", vipRules: "" };
            let sha = "";

            if (fileCheck.ok) {
                const fileData = await fileCheck.json();
                sha = fileData.sha;
                // Декодируем то, что сейчас реально лежит в облаке
                const decodedContent = decodeURIComponent(escape(atob(fileData.content)));
                try { remoteData = JSON.parse(decodedContent); } catch(e) {}
            }

            // Шаг Б: УМНЫЙ MERGE (СЛИЯНИЕ ДАННЫХ)
            
            // 1. Слияние ОПТ (База Скидок Текст)
            // Объединяем локальные и серверные правила, приоритет у локальных (свежих)
            const mergeTextRules = (localText, remoteText) => {
                const map = {};
                const parseToMap = (text) => {
                    if (!text) return;
                    text.split(',').forEach(r => {
                        const [b, s] = r.split(':');
                        if (b && s) map[b.trim().toLowerCase()] = { origName: b.trim(), val: s.trim() };
                    });
                };
                parseToMap(remoteText); // Сначала пишем из облака
                parseToMap(localText);  // Потом поверх заменяем локальными
                return Object.values(map).map(item => `${item.origName}: ${item.val}`).join(', ');
            };

            const finalBrandRules = mergeTextRules(localBrandText, remoteData.brandRules);
            const finalDropRules = mergeTextRules(localDropText, remoteData.dropRules);

            // 2. Слияние VIP клиентов (Борьба с затиранием имен)
            const vipMap = {};
            const parseVipToMap = (vipString) => {
                if (!vipString) return;
                vipString.split('\n').forEach(line => {
                    if (line.includes('|')) {
                        const [name, rules] = line.split('|');
                        // Ключ — имя клиента маленькими буквами
                        vipMap[name.trim().toLowerCase()] = { origName: name.trim(), rules: rules.trim() };
                    }
                });
            };

            // Собираем VIP-строку из текущего интерфейса
            const localVipString = localVipArray.map(item => `${item.name} | ${item.rules}`).join('\n');
            
            parseVipToMap(remoteData.vipRules); // Загружаем VIP из облака
            parseVipToMap(localVipString);     // Накладываем VIP с текущего ПК (добавляем новых, обновляем старых)

            // Собираем итоговую объединенную VIP строку
            const finalVipString = Object.values(vipMap).map(item => `${item.origName} | ${item.rules}`).join('\n');

            // Шаг В: Кодируем объединенный результат в Base64 для отправки
            const contentObject = { 
                brandRules: finalBrandRules, 
                dropRules: finalDropRules, 
                vipRules: finalVipString 
            };
            
            const utf8Bytes = new TextEncoder().encode(JSON.stringify(contentObject, null, 2));
            const base64Content = btoa(String.fromCharCode(...utf8Bytes));

            // Шаг Г: Отправляем объединенную базу обратно на GitHub
            const putResponse = await fetch(apiUrl, {
                method: 'PUT',
                headers: { 'Authorization': `token ${token}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                    message: "Team Cloud Merge via Extension", 
                    content: base64Content, 
                    sha: sha ? sha : undefined 
                })
            });

            if (putResponse.ok) {
                // ОБЯЗАТЕЛЬНО: Обновляем интерфейс у текущего пользователя, чтобы он тоже увидел объединенные данные
                document.getElementById('brandRules').value = finalBrandRules;
                document.getElementById('dropRules').value = finalDropRules;
                localVipArray = [];
                parseVipRules(finalVipString);
                renderVipList();

                // Фиксируем результат в локальной памяти расширения
                chrome.storage.local.set({ 
                    brandRules: finalBrandRules, 
                    dropRules: finalDropRules, 
                    vipRules: finalVipString, 
                    githubUrl: rawUrl, 
                    githubToken: token 
                });

                alert('🚀 Умная синхронизация завершена! Все данные объединены и сохранены в Облаке без затирания коллег.');
            } else { 
                alert('❌ GitHub отклонил сохранение. Попробуйте еще раз.'); 
            }
        } catch (e) { 
            alert('❌ Ошибка автоматического слияния баз.'); 
            console.error(e);
        } finally { 
            btn.innerText = '📤 Отправить в Облако'; btn.disabled = false; 
        }
    });

    // 9. РУЧНОЙ ЭКСПОРТ В ФАЙЛ БЭКАПА
    document.getElementById('exportBtn').addEventListener('click', () => {
        const exportObject = { 
            brandRules: document.getElementById('brandRules').value.trim(), 
            dropRules: document.getElementById('dropRules').value.trim(), 
            vipRules: localVipArray.map(item => `${item.name} | ${item.rules}`).join('\n') 
        };
        const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(exportObject, null, 2));
        const anchor = document.createElement('a'); 
        anchor.setAttribute("href", dataStr); 
        anchor.setAttribute("download", "moysklad_backup.json"); 
        anchor.click(); anchor.remove();
    });

    // 10. РУЧНОЙ ИМПОРТ ИЗ ФАЙЛА БЭКАПА
    document.getElementById('importBtn').addEventListener('click', () => { document.getElementById('fileInput').click(); });
    document.getElementById('fileInput').addEventListener('change', (e) => {
        const file = e.target.files[0]; if (!file) return;
        const reader = new FileReader();
        reader.onload = (evt) => {
            try {
                const parsed = JSON.parse(evt.target.result);
                if ('brandRules' in parsed && 'dropRules' in parsed) {
                    document.getElementById('brandRules').value = parsed.brandRules || "";
                    document.getElementById('dropRules').value = parsed.dropRules || "";
                    localVipArray = []; 
                    parseVipRules(parsed.vipRules || ""); 
                    renderVipList();
                    alert('📥 Бэкап успешно считан! Нажмите зеленую кнопку для сохранения.');
                }
            } catch(err) { alert('❌ Ошибка структуры файла бэкапа.'); }
        }; 
        reader.readAsText(file); 
        e.target.value = '';
    });
});

// --- ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ---

function parseVipRules(vipRulesString) {
    if (!vipRulesString) return;
    vipRulesString.split('\n').forEach(line => { 
        if (line.includes('|')) { 
            const [name, rules] = line.split('|'); 
            localVipArray.push({ name: name.trim(), rules: rules.trim() }); 
        } 
    });
}

function saveAllToStorage() {
    const brandText = document.getElementById('brandRules').value.trim();
    const dropText = document.getElementById('dropRules').value.trim();
    const urlText = document.getElementById('githubUrl').value.trim();
    const tokenText = document.getElementById('githubToken').value.trim();
    const vipString = localVipArray.map(item => `${item.name} | ${item.rules}`).join('\n');

    chrome.storage.local.set({ 
        brandRules: brandText, 
        dropRules: dropText, 
        vipRules: vipString, 
        githubUrl: urlText, 
        githubToken: tokenText 
    }, () => { alert('✅ Настройки успешно зафиксированы на этом ПК!'); });
}

function renderVipList() {
    const container = document.getElementById('vipList'); 
    container.innerHTML = '';
    
    if (localVipArray.length === 0) { 
        container.innerHTML = '<div style="padding:10px;color:#888;text-align:center;font-size:11px;">Список VIP пуст</div>'; 
        return; 
    }
    
    localVipArray.forEach((vip, index) => {
        const item = document.createElement('div'); item.className = 'vip-item';
        const nameDiv = document.createElement('div'); nameDiv.className = 'vip-name'; nameDiv.innerText = vip.name; nameDiv.title = vip.name;
        const actionsDiv = document.createElement('div'); actionsDiv.className = 'vip-actions';
        
        // Кнопка настройки (⚙️)
        const editBtn = document.createElement('button'); editBtn.className = 'btn-edit'; editBtn.innerText = '⚙️';
        editBtn.onclick = () => {
            activeEditIndex = index;
            document.getElementById('modalTitle').innerText = `⚙️ Скидки для: ${vip.name}`;
            document.getElementById('brandSearchInput').value = ""; 
            document.getElementById('searchStatus').innerText = "";
            
            currentVipRulesArray = [];
            if (vip.rules) {
                vip.rules.split(',').forEach(r => {
                    if (!r.includes(':')) return;
                    const [b, s] = r.split(':');
                    if (b && s) {
                        currentVipRulesArray.push({ brand: b.trim(), discount: parseInt(s.trim()) || 0 });
                    }
                });
            }

            document.getElementById('modalRules').value = currentVipRulesArray.map(r => `${r.brand}: ${r.discount}`).join(',\n');
            document.getElementById('modalRules').disabled = false;
            document.getElementById('modal').style.display = 'flex';
        };
        
        // Кнопка удаления (🗑️)
        const delBtn = document.createElement('button'); delBtn.className = 'btn-delete'; delBtn.innerText = '🗑️';
        delBtn.onclick = () => { 
            if (confirm(`Удалить клиента "${vip.name}"?`)) { 
                localVipArray.splice(index, 1); 
                renderVipList(); 
            } 
        };
        
        actionsDiv.appendChild(editBtn); 
        actionsDiv.appendChild(delBtn); 
        item.appendChild(nameDiv); 
        item.appendChild(actionsDiv); 
        container.appendChild(item);
    });
}