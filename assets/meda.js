import { initializeApp, getApps, getApp } from "https://www.gstatic.com/firebasejs/10.5.0/firebase-app.js";
import { getAuth, signInAnonymously } from "https://www.gstatic.com/firebasejs/10.5.0/firebase-auth.js";
import {
    getFirestore,
    collection,
    getDocs,
    doc,
    getDoc,
    setDoc,
    updateDoc,
    runTransaction
} from "https://www.gstatic.com/firebasejs/10.5.0/firebase-firestore.js";

const firebaseConfig = {
    apiKey: "AIzaSyAtZN8CGdH0M-OTs9Z2gGCsiA2AWJ0WRXg",
    authDomain: "meda-e0955.firebaseapp.com",
    projectId: "meda-e0955",
    storageBucket: "meda-e0955.firebasestorage.app",
    messagingSenderId: "446317572827",
    appId: "1:446317572827:web:bdad243a1e5ba1ceba12fe",
    measurementId: "G-8FVX96XD07"
};

const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);

const DEFAULT_ADMIN_PASS = "meda2026";
const ADMIN_SESSION_KEY = "meda_admin_authenticated";
const ADMIN_HASH_KEY = "meda_admin_pass_hash";

// Băm SHA-256 cho mật khẩu
export async function sha256Pass(text) {
    const raw = "meda_admin::" + String(text || "").trim();
    try {
        if (window.crypto && crypto.subtle && crypto.subtle.digest) {
            const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(raw));
            return "sha256:" + Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");
        }
    } catch (_) {}
    let h1 = 0x811c9dc5, h2 = 0x1000193;
    for (let i = 0; i < raw.length; i++) {
        h1 = Math.imul(h1 ^ raw.charCodeAt(i), 16777619) >>> 0;
        h2 = Math.imul(h2 + raw.charCodeAt(i) * (i + 7), 2654435761) >>> 0;
    }
    return "fb:" + h1.toString(16).padStart(8, "0") + h2.toString(16).padStart(8, "0");
}

function fmtDateVN(d = new Date()) {
    const vn = new Date(d.toLocaleString("en-US", { timeZone: "Asia/Ho_Chi_Minh" }));
    return `${vn.getDate().toString().padStart(2, "0")}/${(vn.getMonth() + 1).toString().padStart(2, "0")}/${vn.getFullYear()}`;
}

function fmtDateTimeVN(d = new Date()) {
    const vn = new Date(d.toLocaleString("en-US", { timeZone: "Asia/Ho_Chi_Minh" }));
    const time = `${vn.getHours().toString().padStart(2, "0")}:${vn.getMinutes().toString().padStart(2, "0")}:${vn.getSeconds().toString().padStart(2, "0")}`;
    const date = `${vn.getDate().toString().padStart(2, "0")}/${(vn.getMonth() + 1).toString().padStart(2, "0")}/${vn.getFullYear()}`;
    return `${time} ${date}`;
}

function getVNCurrentHour() {
    const vn = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Ho_Chi_Minh" }));
    return vn.getHours();
}

// 1. Khởi tạo kết nối (không bắt buộc bật Anonymous Auth vẫn chạy được)
export async function ready() {
    try {
        if (!auth.currentUser) {
            await signInAnonymously(auth).catch(() => null);
        }
    } catch (_) {}
    return auth.currentUser || { uid: "anon-spark-user" };
}

// 2. Kiểm tra phiên đăng nhập Admin / Nhân viên
export async function readyAdmin() {
    await ready();
    const isLogged = sessionStorage.getItem(ADMIN_SESSION_KEY) === "true";
    if (!isLogged) {
        throw new Error("Vui lòng đăng nhập quản trị.");
    }
    return { uid: "admin", admin: true };
}

// 3. Đăng nhập Admin / Nhân viên trực tiếp qua Firestore (Không cần Cloud Functions)
export async function loginAdmin(password) {
    const pass = String(password || "").trim();
    if (!pass) throw new Error("Vui lòng nhập mật khẩu!");
    await ready();

    const inputHash = await sha256Pass(pass);
    const adminRef = doc(db, "config", "admin");
    const snap = await getDoc(adminRef).catch(() => null);

    if (snap && snap.exists() && snap.data().passHash) {
        const savedHash = snap.data().passHash;
        const savedPlain = snap.data().password;
        if (inputHash !== savedHash && pass !== savedPlain) {
            throw new Error("Sai mật khẩu! Vui lòng kiểm tra lại.");
        }
    } else {
        // Lần đầu tiên chưa có mật khẩu trên Firestore -> chấp nhận mật khẩu mặc định meda2026 hoặc admin123
        if (pass !== DEFAULT_ADMIN_PASS && pass !== "admin123" && pass !== "123456") {
            throw new Error(`Sai mật khẩu! (Mật khẩu mặc định lần đầu là: ${DEFAULT_ADMIN_PASS})`);
        }
        await setDoc(adminRef, {
            passHash: inputHash,
            recoveryCode: "meda2026",
            updatedAt: Date.now()
        }, { merge: true }).catch(() => {});
    }

    sessionStorage.setItem(ADMIN_SESSION_KEY, "true");
    sessionStorage.setItem(ADMIN_HASH_KEY, inputHash);
    return { uid: "admin", admin: true };
}

// 4. Đăng xuất
export function logoutAdmin() {
    sessionStorage.removeItem(ADMIN_SESSION_KEY);
    sessionStorage.removeItem(ADMIN_HASH_KEY);
    sessionStorage.removeItem("meda_zalo_unlocked");
    window.location.reload();
}

// 5. Đổi mật khẩu Admin
export async function changeAdminPassword(oldPass, newPass) {
    await loginAdmin(oldPass);
    const newHash = await sha256Pass(newPass);
    await setDoc(doc(db, "config", "admin"), {
        passHash: newHash,
        updatedAt: Date.now()
    }, { merge: true });
    sessionStorage.setItem(ADMIN_HASH_KEY, newHash);
    return { ok: true };
}

// ==================== HỆ THỐNG ZALO TRỰC TIẾP & ĐỒNG BỘ 24/7 ====================

async function loadFullZaloSettings() {
    const [zaloSnap, tokenSnap] = await Promise.all([
        getDoc(doc(db, "config", "zalo")).catch(() => null),
        getDoc(doc(db, "config", "zaloToken")).catch(() => null)
    ]);
    const cfg = (zaloSnap && zaloSnap.exists()) ? zaloSnap.data() : {};
    const tokData = (tokenSnap && tokenSnap.exists()) ? tokenSnap.data() : {};
    const botToken = tokData.botToken || cfg.botToken || "";
    return {
        mode: cfg.mode || "zalo_bot",
        botToken,
        botTokenSet: Boolean(botToken),
        botChatId: cfg.botChatId || "",
        webhookUrl: cfg.webhookUrl || "",
        oaAccessToken: cfg.oaAccessToken || "",
        oaTokenSet: Boolean(cfg.oaAccessToken),
        oaRecipientId: cfg.oaRecipientId || "",
        corsProxy: cfg.corsProxy || "",
        phone: cfg.phone || "",
        enableAuto: cfg.enableAuto !== false,
        notifyLowStock: cfg.notifyLowStock !== false,
        notifyOutProduct: cfg.notifyOutProduct !== false,
        notifyOrderDaily: cfg.notifyOrderDaily !== false,
        autoDailySummary: cfg.autoDailySummary !== false,
        summaryHour: cfg.summaryHour ?? 21,
        lastDailySummaryDate: cfg.lastDailySummaryDate || "",
        lastDailySummaryAt: cfg.lastDailySummaryAt || 0,
        zaloCodeHash: cfg.zaloCodeHash || ""
    };
}

export async function sendMessageToZalo(text, type = "notification", extraData = {}) {
    const cfg = await loadFullZaloSettings();
    const mode = cfg.mode || "zalo_bot";

    if (mode === "zalo_bot") {
        if (!cfg.botToken || !cfg.botChatId) {
            return { ok: false, reason: "Chưa cấu hình Zalo Bot Token hoặc Chat ID!", message: text };
        }
        const targetUrl = `https://bot-api.zapps.me/bot${cfg.botToken}/sendMessage`;
        const formBody = new URLSearchParams();
        formBody.append("chat_id", cfg.botChatId);
        formBody.append("text", text);

        // Nếu có cấu hình Google Apps Script / Proxy thì gọi song song để đảm bảo 100%
        if (cfg.corsProxy) {
            try {
                await fetch(cfg.corsProxy, {
                    method: "POST",
                    mode: "no-cors",
                    headers: { "Content-Type": "text/plain;charset=utf-8" },
                    body: JSON.stringify({
                        action: "sendZalo",
                        botToken: cfg.botToken,
                        chatId: cfg.botChatId,
                        text,
                        type,
                        data: extraData
                    })
                });
            } catch (_) {}
        }

        await fetch(targetUrl, {
            method: "POST",
            mode: "no-cors",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: formBody.toString()
        });
        return { ok: true, message: text, text };
    }

    if (mode === "webhook") {
        if (!cfg.webhookUrl) {
            return { ok: false, reason: "Chưa nhập Webhook URL!", message: text };
        }
        await fetch(cfg.webhookUrl, {
            method: "POST",
            mode: "no-cors",
            headers: { "Content-Type": "text/plain;charset=utf-8" },
            body: JSON.stringify({
                shop: "Mê Đá",
                type,
                message: text,
                text,
                content: text,
                data: extraData
            })
        });
        return { ok: true, message: text, text };
    }

    if (mode === "zalo_oa") {
        if (!cfg.oaAccessToken || !cfg.oaRecipientId) {
            return { ok: false, reason: "Chưa nhập Zalo OA Access Token hoặc User ID!", message: text };
        }
        const oaEndpoint = cfg.corsProxy || "https://openapi.zalo.me/v3.0/oa/message/cs";
        await fetch(oaEndpoint, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "access_token": cfg.oaAccessToken
            },
            body: JSON.stringify({
                recipient: { user_id: cfg.oaRecipientId },
                message: { text }
            })
        });
        return { ok: true, message: text, text };
    }

    return { ok: false, reason: "Phương thức Zalo không hợp lệ.", message: text };
}

function calcMaxCups(product, inventory) {
    if (!product.recipe || product.recipe.length === 0) return 999;
    let maxCups = Infinity;
    product.recipe.forEach(ri => {
        const inv = inventory.find(i => i.id === ri.ingId);
        if (!inv || Number(inv.quantity) < Number(ri.amount)) maxCups = 0;
        else maxCups = Math.min(maxCups, Math.floor(Number(inv.quantity) / Number(ri.amount)));
    });
    return maxCups === Infinity ? 0 : maxCups;
}

async function generateStockAlertMessage() {
    const [invSnap, prodSnap] = await Promise.all([
        getDocs(collection(db, "inventory")),
        getDocs(collection(db, "products"))
    ]);
    const inventory = invSnap.docs.map(d => d.data());
    const products = prodSnap.docs.map(d => ({ ...d.data(), id: d.id }));

    const outIngs = inventory.filter(i => Number(i.quantity) <= 0).map(i => `• ❌ ${i.name}: HẾT SẠCH (0 ${i.unit})`);
    const lowIngs = inventory.filter(i => Number(i.quantity) > 0 && Number(i.quantity) <= 50).map(i => `• ⚠️ ${i.name}: Sắp hết (còn ${i.quantity} ${i.unit})`);
    const outProds = products.filter(p => calcMaxCups(p, inventory) === 0).map(p => `• 🚫 ${p.name}: HẾT MÓN (không đủ nguyên liệu)`);

    const hasAlert = outIngs.length > 0 || lowIngs.length > 0 || outProds.length > 0;
    const msg = [
        `⚠️ [MÊ ĐÁ] CẢNH BÁO KHO NGUYÊN LIỆU & MÓN (${fmtDateVN()})`,
        `🕒 Lúc: ${new Date().toLocaleTimeString("vi-VN")}`,
        `========================`,
        ...(hasAlert
            ? [
                ...(outIngs.length ? ["🔴 NGUYÊN LIỆU ĐÃ HẾT:", ...outIngs] : []),
                ...(lowIngs.length ? ["🟡 NGUYÊN LIỆU SẮP HẾT:", ...lowIngs] : []),
                ...(outProds.length ? ["🚫 MÓN TẠM HẾT TRÊN MENU:", ...outProds] : [])
              ]
            : ["✅ Toàn bộ nguyên liệu và các món trong thực đơn đều còn đầy đủ!"])
    ].join("\n");

    return { msg, hasAlert, outIngs, lowIngs, outProds };
}

async function generateDailyReportMessage(targetDateStr = fmtDateVN()) {
    const [finSnap, invSnap, prodSnap, ordersSnap] = await Promise.all([
        getDoc(doc(db, "config", "finance")),
        getDocs(collection(db, "inventory")),
        getDocs(collection(db, "products")),
        getDocs(collection(db, "orders"))
    ]);

    const fin = finSnap.exists() ? finSnap.data() : { fixedCosts: 0, ingredientCosts: 0, totalRevenue: 0 };
    const inventory = invSnap.docs.map(d => d.data());
    const products = prodSnap.docs.map(d => ({ ...d.data(), id: d.id }));
    const allOrders = ordersSnap.docs.map(d => d.data());

    const dayOrders = allOrders.filter(o => o.createdAt && o.createdAt.includes(targetDateStr));
    let dailyRevenue = 0;
    let dailyCups = 0;
    const soldMap = {};

    dayOrders.forEach(o => {
        dailyRevenue += Number(o.total || 0);
        if (Array.isArray(o.items)) {
            o.items.forEach(it => {
                const key = it.id || it.name;
                if (!soldMap[key]) soldMap[key] = { name: it.name, qty: 0, rev: 0 };
                soldMap[key].qty += Number(it.quantity || 0);
                soldMap[key].rev += Number(it.price || 0) * Number(it.quantity || 0);
                dailyCups += Number(it.quantity || 0);
            });
        }
    });

    const soldArr = Object.values(soldMap).sort((a, b) => b.qty - a.qty);
    const soldLines = soldArr.length
        ? soldArr.map((s, idx) => `${idx + 1}. ${s.name}: ${s.qty} ly (${s.rev.toLocaleString("vi-VN")}đ)`).join("\n")
        : "• Chưa có món nào bán ra trong ngày.";

    const totalCosts = Number(fin.fixedCosts || 0) + Number(fin.ingredientCosts || 0);
    const totalProfit = Number(fin.totalRevenue || 0) - totalCosts;

    const outIngs = inventory.filter(i => Number(i.quantity) <= 0).map(i => `• ❌ ${i.name} (0 ${i.unit})`);
    const lowIngs = inventory.filter(i => Number(i.quantity) > 0 && Number(i.quantity) <= 50).map(i => `• ⚠️ ${i.name} (còn ${i.quantity} ${i.unit})`);
    const outProds = products.filter(p => calcMaxCups(p, inventory) === 0).map(p => `• 🚫 ${p.name} (Hết món)`);

    const msg = [
        `📊 [MÊ ĐÁ] BÁO CÁO TỔNG KẾT NGÀY ${targetDateStr}`,
        `🕒 Xuất lúc: ${new Date().toLocaleTimeString("vi-VN")}`,
        `========================`,
        `💰 1. DOANH THU HÔM NAY (${targetDateStr}):`,
        `• Tổng số đơn: ${dayOrders.length} đơn (${dailyCups} ly)`,
        `• Doanh thu trong ngày: ${dailyRevenue.toLocaleString("vi-VN")} VNĐ`,
        `------------------------`,
        `📈 LŨY KẾ THÁNG HIỆN TẠI:`,
        `• Tổng thu lũy kế: ${Number(fin.totalRevenue || 0).toLocaleString("vi-VN")} VNĐ`,
        `• Tổng chi phí: ${totalCosts.toLocaleString("vi-VN")} VNĐ`,
        `• Lãi ròng ước tính: ${totalProfit.toLocaleString("vi-VN")} VNĐ`,
        `========================`,
        `🧋 2. CHI TIẾT CÁC MÓN BÁN TRONG NGÀY:`,
        soldLines,
        `========================`,
        `📦 3. TÌNH TRẠNG KHO & THỰC ĐƠN:`,
        ...(outIngs.length || lowIngs.length || outProds.length
            ? [...outIngs, ...lowIngs, ...outProds]
            : ["✅ Nguyên liệu và các món đều còn đủ."])
    ].join("\n");

    return { msg, dailyRevenue, dailyCups, orderCount: dayOrders.length };
}

// 6. Bộ định tuyến toàn bộ tác vụ thay thế hoàn toàn Cloud Functions
export async function callFn(name, payload = {}) {
    await ready();

    switch (name) {
        case "getZaloConfig": {
            const cfg = await loadFullZaloSettings();
            return cfg;
        }

        case "saveZaloConfig": {
            const clean = {
                mode: payload.mode || "zalo_bot",
                botChatId: String(payload.botChatId || "").trim(),
                webhookUrl: String(payload.webhookUrl || "").trim(),
                oaAccessToken: String(payload.oaAccessToken || "").trim(),
                oaRecipientId: String(payload.oaRecipientId || "").trim(),
                corsProxy: String(payload.corsProxy || "").trim(),
                phone: String(payload.phone || "").trim(),
                enableAuto: payload.enableAuto !== false,
                notifyLowStock: payload.notifyLowStock !== false,
                notifyOutProduct: payload.notifyOutProduct !== false,
                notifyOrderDaily: payload.notifyOrderDaily !== false,
                autoDailySummary: payload.autoDailySummary !== false,
                summaryHour: Number(payload.summaryHour ?? 21),
                updatedAt: Date.now()
            };
            await setDoc(doc(db, "config", "zalo"), clean, { merge: true });
            const full = await loadFullZaloSettings();
            return { ok: true, config: full };
        }

        case "setZaloToken": {
            const token = String(payload.token || "").trim();
            if (token) {
                await Promise.all([
                    setDoc(doc(db, "config", "zaloToken"), { botToken: token, updatedAt: Date.now() }, { merge: true }),
                    setDoc(doc(db, "config", "zalo"), { botToken: token, botTokenSet: true, updatedAt: Date.now() }, { merge: true })
                ]);
            }
            return { ok: true };
        }

        case "zaloFetchUpdates": {
            const cfg = await loadFullZaloSettings();
            const token = String(payload.token || cfg.botToken || "").trim();
            if (!token) {
                throw new Error("Bạn chưa lưu Zalo Bot Token! Hãy dán Token rồi bấm '💾 Lưu Cấu Hình Zalo' trước.");
            }
            const getUpdatesUrl = `https://bot-api.zapps.me/bot${token}/getUpdates`;
            const candidates = [
                getUpdatesUrl,
                `https://api.allorigins.win/raw?url=${encodeURIComponent(getUpdatesUrl)}`,
                `https://corsproxy.io/?${encodeURIComponent(getUpdatesUrl)}`
            ];

            let data = null;
            for (const url of candidates) {
                try {
                    const resp = await fetch(url, { method: "GET" });
                    if (resp.ok) {
                        const json = await resp.json();
                        if (json && (json.ok || json.result)) {
                            data = json;
                            break;
                        }
                    }
                } catch (_) {}
            }

            if (data && data.result) {
                const results = Array.isArray(data.result) ? data.result : [data.result];
                for (let i = results.length - 1; i >= 0; i--) {
                    const item = results[i];
                    const msg = item.message || item;
                    const chatId = (msg.chat && msg.chat.id) || (msg.from && msg.from.id) || item.chat_id;
                    const senderName = (msg.from && (msg.from.display_name || msg.from.name)) || "";
                    if (chatId) {
                        await setDoc(doc(db, "config", "zalo"), { botChatId: String(chatId) }, { merge: true });
                        return { ok: true, found: { id: String(chatId), name: senderName } };
                    }
                }
            }
            return { ok: false, found: null };
        }

        case "zaloTest": {
            const msg = [
                `🔔 [MÊ ĐÁ] KIỂM TRA KẾT NỐI ZALO THÀNH CÔNG!`,
                `🕒 Thời gian: ${fmtDateTimeVN()}`,
                `✅ Hệ thống thông báo tự động của quán Mê Đá đã sẵn sàng hoạt động.`
            ].join("\n");
            return await sendMessageToZalo(msg, "test_connection");
        }

        case "zaloPushStock": {
            if (payload && (payload.message || payload.text)) {
                return await sendMessageToZalo(payload.message || payload.text, "stock_alert");
            }
            const { msg } = await generateStockAlertMessage();
            return await sendMessageToZalo(msg, "stock_alert");
        }

        case "zaloPushReport": {
            if (payload && (payload.message || payload.text)) {
                return await sendMessageToZalo(payload.message || payload.text, "daily_report", payload.data || {});
            }
            const todayStr = fmtDateVN();
            const { msg } = await generateDailyReportMessage(todayStr);
            const res = await sendMessageToZalo(msg, "daily_report");
            if (res.ok) {
                await setDoc(doc(db, "config", "zalo"), {
                    lastDailySummaryDate: todayStr,
                    lastDailySummaryAt: Date.now()
                }, { merge: true });
            }
            return res;
        }

        case "runAutomationNow": {
            const cfg = await loadFullZaloSettings();
            const nowHour = getVNCurrentHour();
            const todayStr = fmtDateVN();
            const sent = [];
            const errors = [];

            if (!cfg.enableAuto) {
                errors.push("Chế độ tự động đang TẮT.");
                return { summaryHour: cfg.summaryHour, nowHour, sent, errors };
            }

            // 1. Kiểm tra và gửi cảnh báo tồn kho nếu có nguyên liệu / món hết
            if (cfg.notifyLowStock || cfg.notifyOutProduct) {
                const stockInfo = await generateStockAlertMessage();
                if (stockInfo.hasAlert) {
                    const r1 = await sendMessageToZalo(stockInfo.msg, "stock_alert");
                    if (r1.ok) sent.push("Đã gửi cảnh báo nguyên liệu / món sắp hết.");
                    else errors.push(r1.reason || "Không gửi được cảnh báo kho.");
                } else {
                    sent.push("Kho nguyên liệu & thực đơn đều đầy đủ (không có món hết).");
                }
            }

            // 2. Gửi báo cáo tổng kết ngày nếu đã đến giờ hoặc khi bấm chạy ngay
            if (cfg.autoDailySummary) {
                const rep = await generateDailyReportMessage(todayStr);
                const r2 = await sendMessageToZalo(rep.msg, "daily_report");
                if (r2.ok) {
                    await setDoc(doc(db, "config", "zalo"), {
                        lastDailySummaryDate: todayStr,
                        lastDailySummaryAt: Date.now()
                    }, { merge: true });
                    sent.push(`Đã gửi báo cáo doanh thu ngày ${todayStr}.`);
                } else {
                    errors.push(r2.reason || "Không gửi được báo cáo doanh thu ngày.");
                }
            }

            return { summaryHour: cfg.summaryHour, nowHour, sent, errors };
        }

        case "placeOrder": {
            const rawItems = Array.isArray(payload.items) ? payload.items : [];
            if (!rawItems.length) throw new Error("Giỏ hàng trống!");

            const [prodSnap, invSnap, finSnap] = await Promise.all([
                getDocs(collection(db, "products")),
                getDocs(collection(db, "inventory")),
                getDoc(doc(db, "config", "finance"))
            ]);

            const productsMap = {};
            prodSnap.docs.forEach(d => { productsMap[d.id] = { ...d.data(), id: d.id }; });
            const inventoryMap = {};
            invSnap.docs.forEach(d => { inventoryMap[d.id] = { ...d.data(), id: d.id }; });

            let calculatedTotal = 0;
            const verifiedItems = [];
            const usedIngredients = {};

            for (const item of rawItems) {
                const qty = Math.max(1, parseInt(item.quantity, 10) || 1);
                const dbProd = productsMap[item.id];
                const price = dbProd ? Number(dbProd.price || 0) : Number(item.price || 0);
                const name = dbProd ? dbProd.name : (item.name || "Món nước");

                calculatedTotal += price * qty;
                verifiedItems.push({ id: item.id, name, price, quantity: qty });

                if (dbProd && Array.isArray(dbProd.recipe)) {
                    dbProd.recipe.forEach(ri => {
                        usedIngredients[ri.ingId] = (usedIngredients[ri.ingId] || 0) + Number(ri.amount || 0) * qty;
                    });
                }
            }

            // Cấp số thứ tự theo ngày (không trùng lặp)
            const todayStr = fmtDateVN();
            let queueNumber = 1;
            const queueRef = doc(db, "config", "queue");
            try {
                queueNumber = await runTransaction(db, async (tx) => {
                    const qDoc = await tx.get(queueRef);
                    let nextNum = 1;
                    if (qDoc.exists()) {
                        const qData = qDoc.data();
                        if (qData.date === todayStr) {
                            nextNum = (Number(qData.current) || 0) + 1;
                        }
                    }
                    tx.set(queueRef, { date: todayStr, current: nextNum, updatedAt: Date.now() });
                    return nextNum;
                });
            } catch (_) {
                queueNumber = Math.floor(100 + Math.random() * 900);
            }

            // Trừ kho nguyên liệu
            const invPromises = Object.entries(usedIngredients).map(([ingId, usedAmt]) => {
                const inv = inventoryMap[ingId];
                if (inv) {
                    const newQty = Math.max(0, Number(inv.quantity || 0) - usedAmt);
                    inv.quantity = newQty;
                    return updateDoc(doc(db, "inventory", ingId), { quantity: newQty }).catch(() => {});
                }
                return Promise.resolve();
            });

            // Cộng doanh thu vào config/finance
            const curRev = finSnap.exists() ? Number(finSnap.data().totalRevenue || 0) : 0;
            const finPromise = setDoc(doc(db, "config", "finance"), {
                totalRevenue: curRev + calculatedTotal
            }, { merge: true }).catch(() => {});

            // Lưu đơn hàng vào collection orders
            const createdAt = fmtDateTimeVN();
            const orderDocId = "ord_" + Date.now();
            const orderData = {
                orderId: payload.orderId || orderDocId,
                customerName: payload.customerName || "Khách hàng",
                orderType: payload.orderType || "Tại chỗ",
                items: verifiedItems,
                total: calculatedTotal,
                queueNumber,
                status: "Chờ xử lý",
                createdAt,
                timestamp: Date.now(),
                zaloNotified: true
            };

            await Promise.all([
                ...invPromises,
                finPromise,
                setDoc(doc(db, "orders", orderDocId), orderData)
            ]);

            // Đẩy thông báo đơn mới + doanh thu trong ngày về Zalo ngay lập tức
            try {
                const cfg = await loadFullZaloSettings();
                if (cfg.enableAuto && cfg.notifyOrderDaily) {
                    const ordersSnap = await getDocs(collection(db, "orders"));
                    const todayOrders = ordersSnap.docs.map(d => d.data()).filter(o => o.createdAt && o.createdAt.includes(todayStr));
                    let dailyRev = 0, dailyCups = 0;
                    todayOrders.forEach(o => {
                        dailyRev += Number(o.total || 0);
                        if (Array.isArray(o.items)) {
                            o.items.forEach(it => { dailyCups += Number(it.quantity || 0); });
                        }
                    });

                    const itemLines = verifiedItems.map(i => `  + ${i.name} x${i.quantity} (${(i.price * i.quantity).toLocaleString("vi-VN")}đ)`).join("\n");
                    const allInv = Object.values(inventoryMap);
                    const allProds = Object.values(productsMap);
                    const outIngs = cfg.notifyLowStock ? allInv.filter(i => Number(i.quantity) <= 0).map(i => `❌ Hết NL: ${i.name}`) : [];
                    const lowIngs = cfg.notifyLowStock ? allInv.filter(i => Number(i.quantity) > 0 && Number(i.quantity) <= 50).map(i => `⚠️ Sắp hết NL: ${i.name} (còn ${i.quantity} ${i.unit})`) : [];
                    const outProds = cfg.notifyOutProduct ? allProds.filter(p => calcMaxCups(p, allInv) === 0).map(p => `🚫 Hết món: ${p.name}`) : [];
                    const stockAlerts = [...outIngs, ...lowIngs, ...outProds];

                    const orderMsg = [
                        `🧋 [MÊ ĐÁ] ĐƠN HÀNG MỚI #${queueNumber}`,
                        `🕒 Lúc: ${createdAt}`,
                        `👤 Khách: ${orderData.customerName} (${orderData.orderType})`,
                        `🧾 Mã đơn: #${orderData.orderId}`,
                        `------------------------`,
                        `Chi tiết món:`,
                        itemLines,
                        `💰 Thanh toán đơn này: ${calculatedTotal.toLocaleString("vi-VN")} VNĐ`,
                        `========================`,
                        `📈 Lũy kế hôm nay (${todayStr}): ${dailyRev.toLocaleString("vi-VN")} VNĐ (${todayOrders.length} đơn - ${dailyCups} ly)`,
                        ...(stockAlerts.length ? [`========================`, `⚠️ CẢNH BÁO KHO:`, ...stockAlerts] : [])
                    ].join("\n");

                    await sendMessageToZalo(orderMsg, "new_order", orderData);
                }
            } catch (err) {
                console.warn("Không gửi được thông báo Zalo cho đơn mới:", err);
            }

            return { ok: true, total: calculatedTotal, queueNumber, orderId: orderData.orderId };
        }

        default:
            throw new Error("Tác vụ không xác định: " + name);
    }
}

// Gắn dự phòng vào window để tương thích mọi nơi
if (typeof window !== "undefined") {
    window.medaReadyAdmin = readyAdmin;
    window.medaLogin = loginAdmin;
    window.medaLogout = logoutAdmin;
    window.medaChangePassword = changeAdminPassword;
    window.medaCallFn = callFn;
}