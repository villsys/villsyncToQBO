import { auth, provider, db, functions } from './auth.js';
import { onAuthStateChanged, signInWithPopup, signOut } from "https://www.gstatic.com/firebasejs/12.11.0/firebase-auth.js";
import { collection, getDocs } from "https://www.gstatic.com/firebasejs/12.11.0/firebase-firestore.js";
import { httpsCallable } from "https://www.gstatic.com/firebasejs/12.11.0/firebase-functions.js";

const appRoot = document.getElementById('app-root');
const authBtn = document.getElementById('authBtn');
export let currentUser = null;
export let activeQboConnections = [];

// Helper component for modules under construction
class UnderDevelopmentView {
    constructor(title) { this.title = title; }
    async render() {
        return `
            <div class="container" style="text-align: center; padding: 4rem 2rem;">
                <h2 style="color: #2c3e50;">${this.title} Integration</h2>
                <div style="font-size: 3rem; margin: 1rem 0;">🚧</div>
                <p style="color: #7f8c8d; font-size: 1.1rem;">This module is currently under development.</p>
            </div>
        `;
    }
    async afterRender() {}
}

const routes = {
    '#/': () => import('./home.js').then(m => m.default),
    '#/admin': () => import('./admin.js').then(m => m.default),
    '#/shopify': () => Promise.resolve(class extends UnderDevelopmentView { constructor() { super("Shopify"); } }),
    '#/paypal': () => Promise.resolve(class extends UnderDevelopmentView { constructor() { super("PayPal"); } }),
    '#/ebay': () => Promise.resolve(class extends UnderDevelopmentView { constructor() { super("eBay"); } }),
    '#/bank': () => Promise.resolve(class extends UnderDevelopmentView { constructor() { super("Bank Transactions"); } }),
    '#/creditcard': () => Promise.resolve(class extends UnderDevelopmentView { constructor() { super("Credit Card Transactions"); } })
};

async function router() {
    let hash = window.location.hash || '#/';
    
    // Update sidebar active state
    document.querySelectorAll('.sidebar-link').forEach(link => {
        link.classList.remove('active');
        if (link.dataset.route === hash) link.classList.add('active');
    });

    // Prevent loading protected modules if the user is not logged in
    if (typeof currentUser === 'undefined' || !currentUser) {
        appRoot.innerHTML = `
            <div style="padding: 60px 20px; text-align: center; background-color: #ffffff; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.05); margin: 20px;">
                <h2 style="color: #2c3e50; margin-bottom: 15px;">Welcome to VilSync To QBO</h2>
                <p style="color: #6c757d; font-size: 1.1em;">Please click "Admin Login" in the top right to access your integration modules and connect to QuickBooks.</p>
            </div>
        `;
        return; 
    }

    const loadView = routes[hash] || routes['#/'];
    
    try {
        const ViewComponent = await loadView();
        const viewInstance = new ViewComponent();
        appRoot.innerHTML = await viewInstance.render();
        await viewInstance.afterRender();
    } catch (error) {
        console.error("Routing Error:", error);
        appRoot.innerHTML = `<div class="container"><h2>Module Load Error</h2></div>`;
    }
}

async function fetchQboConnections() {
    if (!currentUser) {
        activeQboConnections = [];
        renderQboHeader();
        return;
    }
    try {
        const snap = await getDocs(collection(db, "users", currentUser.uid, "qbo_connections"));
        activeQboConnections = [];
        snap.forEach(doc => activeQboConnections.push({ id: doc.id, ...doc.data() }));
        renderQboHeader();
    } catch (error) {
        activeQboConnections = [];
        renderQboHeader();
    }
}

function renderQboHeader() {
    const container = document.getElementById('qbo-container');
    if (!container) return;

    if (!currentUser) {
        container.innerHTML = '';
        return;
    }

    if (activeQboConnections.length === 0) {
        container.innerHTML = `<button id="connectQboBtn" class="btn qbo-btn">Connect to QuickBooks</button>`;
        document.getElementById('connectQboBtn').addEventListener('click', initiateQboAuth);
    } else {
        let optionsHtml = '';
        activeQboConnections.forEach(conn => {
            optionsHtml += `<option value="${conn.realmId}">${conn.companyName}</option>`;
        });

        container.innerHTML = `
            <select id="qboSelect" class="qbo-select">
                ${optionsHtml}
            </select>
            <button id="connectNewQboBtn" class="btn qbo-btn outline-qbo">+ Add QBO</button>
        `;
        document.getElementById('connectNewQboBtn').addEventListener('click', initiateQboAuth);
    }
}

function initiateQboAuth() {
    const intuitAuthUrl = "https://appcenter.intuit.com/connect/oauth2";
    const clientId = "AB7QYE8V27HFW4cCTIt7DsJWcTf9HFJoeLmW875gjPKwPWBvPQ"; 
    const redirectUri = window.location.origin + window.location.pathname; 
    const scope = "com.intuit.quickbooks.accounting";
    const state = "security_token_" + Math.random().toString(36).substring(7);
    window.location.href = `${intuitAuthUrl}?client_id=${clientId}&redirect_uri=${redirectUri}&response_type=code&scope=${scope}&state=${state}`;
}

async function handleOauthCallback() {
    const urlParams = new URLSearchParams(window.location.search);
    const authCode = urlParams.get('code');
    const realmId = urlParams.get('realmId');

    if (authCode && realmId) {
        document.getElementById('app-root').innerHTML = `<div class="container" style="text-align:center;"><h2>Connecting to QuickBooks...</h2><p>Please wait, establishing secure server-to-server connection.</p></div>`;
        try {
            const exchangeQboToken = httpsCallable(functions, 'exchangeQboToken');
            const redirectUri = window.location.origin + window.location.pathname;
            await exchangeQboToken({ authCode: authCode, realmId: realmId, redirectUri: redirectUri });
            window.history.replaceState({}, document.title, window.location.pathname + window.location.hash);
            alert("Successfully connected to QuickBooks!");
            await fetchQboConnections();
            router(); 
        } catch (error) {
            alert("Failed to connect to QBO. See browser console for details.");
            router();
        }
    } else {
        router();
    }
}

window.addEventListener('hashchange', router);

document.addEventListener('DOMContentLoaded', () => {
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get('code')) handleOauthCallback();
    else router();

    onAuthStateChanged(auth, user => {
        currentUser = user;
        authBtn.innerText = user ? "Logout" : "Admin Login";
        if (user) fetchQboConnections(); 
        else {
            activeQboConnections = [];
            renderQboHeader();
        }
    });

    authBtn.addEventListener('click', () => {
        if (currentUser) signOut(auth);
        else signInWithPopup(auth, provider);
    });

    // Inject Legal Footer
    const legalFooter = document.createElement('div');
    legalFooter.style.marginTop = 'auto'; // Ensures it sticks to the bottom
    legalFooter.innerHTML = `
        <div style="display: flex; flex-direction: column; align-items: center; gap: 8px; padding: 20px 10px; font-size: 0.85rem; color: #7f8c8d; border-top: 1px solid #eee;">
            <a href="privacy.html" target="_blank" style="color: #3498db; text-decoration: none;">Privacy Policy</a>
            <a href="terms.html" target="_blank" style="color: #3498db; text-decoration: none;">Terms of Service</a>
            <a href="mailto:vnvcpas.excelimporter@gmail.com" style="color: #3498db; text-decoration: none;">Contact Support</a>
            <div style="margin-top: 10px; font-size: 0.75rem; color: #bdc3c7; border-top: 1px solid #f9f9f9; padding-top: 10px; width: 100%; text-align: center;">
                &copy; ${new Date().getFullYear()} Joselito Villarta, CPA, MBA
            </div>
        </div>
    `;

    const sidebar = document.querySelector('.sidebar');
    if (sidebar) {
        sidebar.style.display = 'flex';
        sidebar.style.flexDirection = 'column';
        sidebar.appendChild(legalFooter);
    } else {
        document.body.appendChild(legalFooter);
    }
});
