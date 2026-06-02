// --- БЛОК ПЕРЕМЕЩЕНИЯ ПАНЕЛИ КНОПОК ---
let isDragging = false;
let startX, startY, initialX, initialY;

async function setupDraggable(container, handle) {
    handle.addEventListener('mousedown', (e) => {
        isDragging = true;
        startX = e.clientX; startY = e.clientY;
        initialX = container.offsetLeft; initialY = container.offsetTop;
        container.style.cursor = 'grabbing';
    });
    document.addEventListener('mousemove', (e) => {
        if (!isDragging) return;
        container.style.left = (initialX + (e.clientX - startX)) + 'px';
        container.style.top = (initialY + (e.clientY - startY)) + 'px';
        container.style.right = 'auto';
    });
    document.addEventListener('mouseup', () => {
        if (isDragging) {
            isDragging = false;
            container.style.cursor = 'default';
            chrome.storage.local.set({ panelPos: { top: container.style.top, left: container.style.left } });
        }
    });
}

// --- УМНЫЙ ПОИСК VIP КЛИЕНТА (ДЛЯ ЗАКАЗОВ) ---
async function checkVipStatus() {
    const data = await chrome.storage.local.get(['vipRules']);
    const vipLines = (data.vipRules || "").split('\n');
    const pageContent = document.body.innerText.toLowerCase();
    const allInputs = Array.from(document.querySelectorAll('input')).map(i => i.value.toLowerCase()).join(' ');

    for (let line of vipLines) {
        if (!line.includes('|')) continue;
        const targetName = line.split('|')[0].trim().toLowerCase();
        if (targetName.length > 2 && (pageContent.includes(targetName) || allInputs.includes(targetName))) {
            return line;
        }
    }
    return null;
}

function textToRulesObject(textString) {
    const rulesObj = {};
    if (!textString) return rulesObj;
    textString.split(',').forEach(r => {
        const [b, s] = r.split(':');
        if (b && s) rulesObj[b.trim().toLowerCase()] = parseInt(s.trim());
    });
    return rulesObj;
}

// --- НАДЕЖНЫЙ МЕТОД ЗАПИСИ (ПРОДАВЛИВАНИЕ ЧЕРЕЗ ПРОТОТИП) ---
function forceGwtValue(inputElement, textValue) {
    if (!inputElement) return false;
    inputElement.focus();
    inputElement.click();
    inputElement.select();
    try {
        const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
        valueSetter.call(inputElement, textValue);
    } catch (e) {
        inputElement.value = textValue;
    }
    inputElement.dispatchEvent(new InputEvent('input', { bubbles: true, cancelable: true, inputType: 'insertText', data: textValue }));
    inputElement.dispatchEvent(new Event('change', { bubbles: true }));
    inputElement.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'Enter', keyCode: 13 }));
    inputElement.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, cancelable: true, key: 'Enter', keyCode: 13 }));
    inputElement.dispatchEvent(new Event('blur', { bubbles: true }));
    return true;
}

// --- ТЕКУЩИЙ РЕЖИМ РАБОТЫ ДЛЯ ОТГРУЗОК ---
let currentDemandMode = null; // может быть 'reset' или 'vat'

// --- ГЛОБАЛЬНЫЙ ПЕРЕХВАТЧИК ДЛЯ ОТГРУЗОК (ВКЛЮЧАЕТСЯ СТРОГО НА DEMAND) ---
document.addEventListener('focusin', (event) => {
    const hash = window.location.hash.toLowerCase();
    
    // ЖЁСТКИЙ МУЛЬТИ-ЗАМОК: если мы не в отгрузке или режим не выбран — полностью игнорируем фокус
    if (!hash.includes('demand') || !currentDemandMode) return; 

    const activeEl = event.target;

    // Проверяем, что это действительно инпут цен
    if (activeEl && activeEl.tagName === 'INPUT' && (activeEl.style.textAlign === 'right' || activeEl.className.includes('gwt-TextBox'))) {
        
        if (currentDemandMode === 'reset') {
            forceGwtValue(activeEl, "0");
        } 
        else if (currentDemandMode === 'vat') {
            let rawValue = activeEl.value ? activeEl.value.replace(/\s/g, '').replace(/\u00A0/g, '').replace(/\s+/g, '').replace(',', '.') : "0";
            let currentPrice = parseFloat(rawValue) || 0;

            if (currentPrice > 0) {
                let priceWithoutVat = (currentPrice / 1.22).toFixed(2);
                let finalPriceStr = priceWithoutVat.toString().replace('.', ',');
                forceGwtValue(activeEl, finalPriceStr);
            }
        }
    }
});

// Переключатели режимов при нажатии на кнопки отгрузки
function toggleDemandMode(mode, buttonEl) {
    if (currentDemandMode === mode) {
        currentDemandMode = null;
        buttonEl.style.border = 'none';
        buttonEl.innerText = mode === 'reset' ? '🗑️ Сбросить цены' : '📉 Цена без НДС';
    } else {
        currentDemandMode = mode;
        
        const otherId = mode === 'reset' ? 'my-vat-btn' : 'my-reset-prices-btn';
        const otherBtn = document.getElementById(otherId);
        if (otherBtn) {
            otherBtn.style.border = 'none';
            otherBtn.innerText = mode === 'reset' ? '📉 Цена без НДС' : '🗑️ Сбросить цены';
        }
        
        buttonEl.style.border = '2px solid #000000';
        buttonEl.innerText = '⚡ Кликни по цене';
    }
}

// --- ФУНКЦИЯ ДЛЯ СБРОСА СКИДОК (ЗАКАЗЫ) ---
async function resetAllDiscounts() {
    const nameElements = document.querySelectorAll('[data-test-id="name"]');
    if (nameElements.length === 0) return alert("Товары не найдены на странице заказа!");

    for (let nameEl of nameElements) {
        const row = nameEl.closest('tr');
        const discountInput = row?.querySelector('input[data-test-id="discount-cell-input"]');
        if (!discountInput) continue;

        forceGwtValue(discountInput, "0");
        await new Promise(r => setTimeout(r, 35)); // Даем МоемуСкладу время на прогрузку каждой строки в Заказах
    }
}

// --- ЛОГИКА ОПРЕДЕЛЕНИЯ И ВВОДА СКИДОК (ЗАКАЗЫ) --- 
async function applyDiscounts(mode) {
    const data = await chrome.storage.local.get(['brandRules', 'dropRules']);
    const vipLine = await checkVipStatus();
    
    const rawBrandData = (mode === 'drop') ? data.dropRules : data.brandRules;
    const rules = textToRulesObject(rawBrandData);

    let vipDiscounts = {};
    if (mode === 'vip' && vipLine) {
        vipDiscounts = textToRulesObject(vipLine.split('|')[1]);
    }

    const nameElements = document.querySelectorAll('[data-test-id="name"]');

    for (let nameEl of nameElements) {
        const row = nameEl.closest('tr');
        const discountInput = row?.querySelector('input[data-test-id="discount-cell-input"]');
        if (!discountInput) continue;

        // Брем текст СТРОГО из ячейки наименования текущего товара
        const productName = nameEl.innerText.trim().toLowerCase();
        
        let finalDiscount = 0;

        // Поиск совпадения бренда СТРОГО внутри имени товара
        const findSmartMatch = (rulesObj) => {
            for (let brand in rulesObj) {
                const cleanBrand = brand.trim().toLowerCase();
                if (cleanBrand.length < 2) continue;
                
                // Создаем регулярку для поиска точного вхождения бренда в название товара
                const regex = new RegExp('\\b' + cleanBrand + '\\b', 'i');
                if (regex.test(productName)) {
                    return rulesObj[brand];
                }
            }
            return 0;
        };

        // Сначала смотрим базовые опт/дроп правила
        finalDiscount = findSmartMatch(rules);

        // Если режим VIP, то правила из строки випа имеют высший приоритет
        if (mode === 'vip') {
            const vipMatch = findSmartMatch(vipDiscounts);
            if (vipMatch > 0) finalDiscount = vipMatch;
        }

        forceGwtValue(discountInput, finalDiscount.toString());
        await new Promise(r => setTimeout(r, 45));
    }
}

// --- ИНТЕРФЕЙС ПАНЕЛИ КНОПОК ---
async function updateButtons() {
    const currentHash = window.location.hash.toLowerCase();
    const isDemandPage = currentHash.includes('demand');

    let container = document.getElementById('helper-container');
    if (!container) {
        container = document.createElement('div');
        container.id = 'helper-container';
        const posData = await chrome.storage.local.get(['panelPos']);
        const pos = posData.panelPos || { top: '70px', left: (window.innerWidth - 160) + 'px' };
        Object.assign(container.style, {
            position: 'fixed', top: pos.top, left: pos.left, zIndex: '10000',
            display: 'flex', flexDirection: 'column', gap: '6px', alignItems: 'center',
            padding: '6px', background: 'white', borderRadius: '8px', border: '1px solid #ccc',
            boxShadow: '0 4px 10px rgba(0,0,0,0.1)'
        });
        const handle = document.createElement('div');
        Object.assign(handle.style, { width: '40px', height: '8px', background: '#ccc', borderRadius: '4px', cursor: 'grab', marginBottom: '4px' });
        container.appendChild(handle);
        document.body.appendChild(container);
        setupDraggable(container, handle);
    }

    if (isDemandPage) {
        ['my-opt-btn', 'my-drop-btn', 'my-vip-btn', 'my-reset-btn'].forEach(id => document.getElementById(id)?.remove());

        let btnReset = document.getElementById('my-reset-prices-btn');
        if (!btnReset) {
            btnReset = document.createElement('button');
            btnReset.id = 'my-reset-prices-btn'; btnReset.innerText = '🗑️ Сбросить цены';
            styleBtn(btnReset, '#757575', '11px', '8px');
            btnReset.onclick = () => toggleDemandMode('reset', btnReset);
            container.appendChild(btnReset);
        }

        let btnVat = document.getElementById('my-vat-btn');
        if (!btnVat) {
            btnVat = document.createElement('button');
            btnVat.id = 'my-vat-btn'; btnVat.innerText = '📉 Цена без НДС';
            styleBtn(btnVat, '#ff9800', '11px', '8px');
            btnVat.onclick = () => toggleDemandMode('vat', btnVat);
            container.appendChild(btnVat);
        }
    } else {
        // Если вышли из отгрузок — принудительно обнуляем режим перехвата
        currentDemandMode = null;
        ['my-reset-prices-btn', 'my-vat-btn'].forEach(id => document.getElementById(id)?.remove());

        const vipLine = await checkVipStatus();

        if (!document.getElementById('my-opt-btn')) {
            const btn = document.createElement('button');
            btn.id = 'my-opt-btn'; btn.innerText = '📦 ОПТ';
            styleBtn(btn, '#2e7d32', '13px', '10px');
            btn.onclick = () => applyDiscounts('opt');
            container.appendChild(btn);
        }
        if (!document.getElementById('my-drop-btn')) {
            const btn = document.createElement('button');
            btn.id = 'my-drop-btn'; btn.innerText = '🚚 ДРОП';
            styleBtn(btn, '#0277bd', '11px', '6px');
            btn.onclick = () => applyDiscounts('drop');
            container.appendChild(btn);
        }
        
        const vipBtn = document.getElementById('my-vip-btn');
        if (vipLine && !vipBtn) {
            const btn = document.createElement('button');
            btn.id = 'my-vip-btn'; btn.innerText = '🌟 VIP';
            styleBtn(btn, '#d32f2f', '13px', '10px');
            btn.onclick = () => applyDiscounts('vip');
            container.appendChild(btn);
        } else if (!vipLine && vipBtn) {
            vipBtn.remove();
        }

        if (!document.getElementById('my-reset-btn')) {
            const btn = document.createElement('button');
            btn.id = 'my-reset-btn'; btn.innerText = '❌ СБРОС';
            styleBtn(btn, '#757575', '11px', '6px');
            btn.onclick = resetAllDiscounts;
            container.appendChild(btn);
        }
    }
}

function styleBtn(btn, color, fontSize, padding) {
    Object.assign(btn.style, {
        padding: padding, backgroundColor: color, color: 'white', border: 'none',
        borderRadius: '6px', cursor: 'pointer', fontWeight: 'bold', width: '130px',
        fontSize: fontSize, boxShadow: '0 2px 4px rgba(0,0,0,0.2)', textAlign: 'center'
    });
}

window.addEventListener('hashchange', updateButtons);
setInterval(updateButtons, 1000);