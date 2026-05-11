// shopify.js
import { db, functions } from './auth.js'; 
import { collection, doc, getDoc, setDoc, getDocs, writeBatch } from "https://www.gstatic.com/firebasejs/12.11.0/firebase-firestore.js";
import { httpsCallable } from "https://www.gstatic.com/firebasejs/12.11.0/firebase-functions.js";
import { getStorage, ref, uploadBytes } from "https://www.gstatic.com/firebasejs/12.11.0/firebase-storage.js";
import { currentUser } from './app.js';

import { pushShopifySalesReceipts } from './shopifyTransHandlers/salesReceipt.js';
import { pushShopifyRefunds } from './shopifyTransHandlers/refundReceipt.js';
import { pushShopifyExpenses } from './shopifyTransHandlers/expense.js';
import { pushShopifyDeposits } from './shopifyTransHandlers/deposit.js';
import { pushShopifyPayouts } from './shopifyTransHandlers/payout.js';

export default class Shopify {
    constructor() {
        this.transactions = [];
        this.categoriesDict = {};
        this.paymentMethods = new Set();
        this.fileType = null; // 'orders' or 'payouts'
        
        // Live QBO Data
        this.qboAccounts = [];
        this.qboItems = [];

        this.depositAccount = "Shopify Clearing"; 
        this.startDate = "";
        this.endDate = "";
        this.activePaymentMethod = "all"; 
        this.activeMainTab = "all";       
        this.activeSubTab = "table";      
        
        this.userRole = 'guest'; 
        this.userProfile = null;
    }

    parseAmt(val) {
        if (val === undefined || val === null || val === '') return 0;
        return parseFloat(String(val).replace(/,/g, '')) || 0;
    }

    formatDateStr(dateStr) {
        if (!dateStr) return new Date().toISOString().split('T')[0];
        const d = new Date(dateStr);
        if (isNaN(d.getTime())) return new Date().toISOString().split('T')[0];
        
        const formatter = new Intl.DateTimeFormat('en-US', {
            year: 'numeric', month: '2-digit', day: '2-digit'
        });
        const parts = formatter.formatToParts(d);
        const year = parts.find(p => p.type === 'year').value;
        const month = parts.find(p => p.type === 'month').value;
        const day = parts.find(p => p.type === 'day').value;
        return `${year}-${month}-${day}`;
    }

    async render() {
        return `
            <style>
                @keyframes flashWarning { 0% { background-color: #fff3cd; } 50% { background-color: #ffe8a1; } 100% { background-color: #fff3cd; } }
                .desktop-scroll-row { display: flex !important; flex-direction: row !important; flex-wrap: nowrap !important; overflow-x: auto; white-space: nowrap; -webkit-overflow-scrolling: touch; padding-bottom: 6px; }
                .desktop-scroll-row::-webkit-scrollbar { height: 6px; }
                .desktop-scroll-row::-webkit-scrollbar-track { background: #f1f1f1; border-radius: 4px; }
                .desktop-scroll-row::-webkit-scrollbar-thumb { background: #c1c1c1; border-radius: 4px; }
                .qbo-badge { background: #e8f8f5; color: #27ae60; font-size: 0.7rem; padding: 2px 5px; border-radius: 3px; font-weight: bold; margin-left: 5px; white-space: nowrap; }
            </style>
            
            <div class="container" style="padding-top: 0.25rem;">
                <h2 style="margin-top: 0; margin-bottom: 0.25rem; font-size: 1.4rem;">VillSync to QBO: Shopify Integrator</h2>
                <p style="color: #666; font-size: 0.85rem; margin-top: 0;">Upload your <strong>ORDERS_EXPORT.csv</strong> (for Sales Receipts) or <strong>PAYMENT_TRANSACTIONS_EXPORT.csv</strong> (for Payouts & Fees) exactly as downloaded, without any edits.</p>
                <div id="alertBox" class="alert" style="margin-bottom: 0.25rem; padding: 0.4rem;"></div>

                <div id="pushStatusBar" class="desktop-scroll-row" style="background: #f8f9fa; border: 1px solid #dee2e6; border-left: 4px solid #27ae60; padding: 0.4rem 1rem; margin-bottom: 0.25rem; border-radius: 4px; justify-content: space-between; align-items: center; font-size: 0.9rem; position: relative; overflow-y: hidden;">
                    <div id="pushProgressFill" style="position: absolute; left: 0; top: 0; bottom: 0; width: 0%; background: #27ae60; z-index: 0; transition: width 0.3s ease;"></div>
                    <span id="pushStatusText" style="font-weight: 500; color: #2c3e50; z-index: 1; position: relative; transition: color 0.3s ease; margin-right: 15px;">Loading user profile...</span>
                    <span id="limitText" style="color: #666; z-index: 1; position: relative; margin-left: auto;"></span>
                </div>

                <div id="controlPanel" class="control-panel desktop-scroll-row" style="gap: 10px; align-items: center; margin-bottom: 1rem; padding: 0.75rem;">
                    <input type="file" id="csvFile" accept=".csv" style="min-width: 200px;">
                    
                    <div style="display: flex; gap: 5px; align-items: center;">
                        <label style="font-size: 0.8rem; font-weight: bold;">Filter Dates:</label>
                        <input type="date" id="startDate" title="Start Date">
                        <span>to</span>
                        <input type="date" id="endDate" title="End Date">
                    </div>

                    <input type="text" id="depositAccount" value="Shopify Clearing" placeholder="Target Bank/Clearing" style="width: 200px;">
                    <button id="syncQboBtn" class="btn" disabled>Push Current View</button>
                    <button id="viewHistoryBtn" class="btn outline" style="background: white; color: #2c3e50; border: 1px solid #2c3e50;">View Batch History</button>
                </div>

                <div id="paymentTabsContainer" class="tabs payment-tabs desktop-scroll-row" style="border-bottom: 1px solid #ccc; margin-bottom: 5px; gap: 0; display: none;">
                    <button class="tab active" data-paytab="all">All Gateways</button>
                </div>

                <div id="mainTabsContainer" class="tabs main-tabs desktop-scroll-row" style="border-bottom: 2px solid #27ae60; margin-bottom: 0; gap: 0;">
                    <button class="tab active" data-maintab="all">All Data</button>
                </div>

                <div class="tabs sub-tabs desktop-scroll-row" style="background: #f8f9fa; padding-top: 5px; margin-bottom: 1rem;" id="subTabContainer">
                    <button class="tab active" data-subtab="table" style="font-size: 0.9rem; padding: 0.5rem 1rem;">Data Table View</button>
                    <button class="tab" data-subtab="journal" style="font-size: 0.9rem; padding: 0.5rem 1rem;">Summary Journal View</button>
                </div>

                <div id="tabContent">
                    <p style="padding: 2rem; text-align: center; color: #7f8c8d;">Select a QBO Account and upload a Shopify Export CSV to begin.</p>
                </div>
            </div>
            
            <div id="historyModal" class="modal-overlay">
                <div class="modal-content" style="max-width: 900px;">
                    <h2 style="margin-top:0;">QBO Push History (Batches)</h2>
                    <p style="color: #666;">View and reverse recent transaction batches pushed to QuickBooks.</p>
                    <div id="historyTableContainer" style="margin: 1rem 0; max-height: 400px; overflow-y: auto;"></div>
                    <div style="text-align: right; margin-top: 1rem;">
                        <button class="btn outline" onclick="document.getElementById('historyModal').style.display='none'" style="color: black; border-color: #ccc;">Close</button>
                    </div>
                </div>
            </div>
        `;
    }

    async afterRender() {
        await this.checkUserRoleAndLimits();
        
        const qboSelect = document.getElementById('qboSelect');
        if (qboSelect) {
            qboSelect.addEventListener('change', async () => {
                await this.loadLiveQboData();
                await this.loadCategories();
                if (this.transactions.length > 0) this.renderActiveView();
            });
        }
        
        await this.loadLiveQboData();
        await this.loadCategories();
        
        document.getElementById('csvFile').addEventListener('change', e => this.handleFileSelect(e));
        document.getElementById('depositAccount').addEventListener('input', e => {
            this.depositAccount = e.target.value;
            if(this.activeSubTab === 'journal') this.renderActiveView();
        });

        document.getElementById('startDate').addEventListener('change', e => { this.startDate = e.target.value; this.renderActiveView(); });
        document.getElementById('endDate').addEventListener('change', e => { this.endDate = e.target.value; this.renderActiveView(); });
        document.getElementById('syncQboBtn').addEventListener('click', () => this.handlePushToQbo());
        
        document.getElementById('viewHistoryBtn').addEventListener('click', () => {
            if (!currentUser) return this.showAlert("You must be logged in to view history.", "warning");
            document.getElementById('historyModal').style.display = 'flex';
            this.loadBatchHistory();
        });

        this.attachSubTabListeners();
        window.deleteBatch = (batchId, realmId) => this.handleDeleteBatch(batchId, realmId);
    }

    async checkUserRoleAndLimits() {
        if (!currentUser) {
            document.getElementById('tabContent').innerHTML = `<p style="padding: 2rem; text-align: center; color: #7f8c8d;">Please log in to continue.</p>`;
            return;
        }
        
        this.userRole = 'guest'; 
        if (currentUser.email === 'vnvcpas.excelimporter@gmail.com') {
            this.userRole = 'super_admin';
        } else {
            try {
                const adminDoc = await getDoc(doc(db, "global_config", "admins"));
                if (adminDoc.exists() && adminDoc.data()[currentUser.email]) this.userRole = 'admin';
            } catch (e) {}
        }

        const profileRef = doc(db, "users", currentUser.uid, "profile", "billing");
        const profileSnap = await getDoc(profileRef);

        if (!profileSnap.exists()) {
            this.userProfile = { email: currentUser.email, role: this.userRole, monthlyBatchesPushed: 0, monthlyLimit: this.userRole === 'guest' ? 10 : Infinity, billingPeriodEnd: new Date(new Date().setMonth(new Date().getMonth() + 1)).toISOString() };
            await setDoc(profileRef, this.userProfile);
        } else {
            this.userProfile = profileSnap.data();
            if (new Date() > new Date(this.userProfile.billingPeriodEnd)) {
                this.userProfile.monthlyBatchesPushed = 0;
                this.userProfile.billingPeriodEnd = new Date(new Date().setMonth(new Date().getMonth() + 1)).toISOString();
                await setDoc(profileRef, { monthlyBatchesPushed: 0, billingPeriodEnd: this.userProfile.billingPeriodEnd }, { merge: true });
            }
        }
        this.updateReadyStatus();
    }

    // THE LIVE DATA FETCHER
    async loadLiveQboData() {
        this.qboAccounts = [];
        this.qboItems = [];
        
        const qboSelect = document.getElementById('qboSelect');
        if (!qboSelect || !qboSelect.value || !currentUser) return;

        try {
            const fetchQboLists = httpsCallable(functions, 'fetchQboLists');
            const res = await fetchQboLists({ realmId: qboSelect.value });
            this.qboAccounts = res.data.accounts || [];
            this.qboItems = res.data.items || [];
        } catch (e) {
            console.error("Failed to load live QBO data", e);
        }
    }

    attachPaymentTabListeners() {
        document.querySelectorAll('.payment-tabs .tab').forEach(tab => {
            tab.addEventListener('click', (e) => {
                document.querySelectorAll('.payment-tabs .tab').forEach(t => t.classList.remove('active'));
                e.target.classList.add('active');
                this.activePaymentMethod = e.target.dataset.paytab;
                this.renderActiveView();
            });
        });
    }

    attachMainTabListeners() {
        document.querySelectorAll('.main-tabs .tab').forEach(tab => {
            tab.addEventListener('click', (e) => {
                document.querySelectorAll('.main-tabs .tab').forEach(t => t.classList.remove('active'));
                e.target.classList.add('active');
                this.activeMainTab = e.target.dataset.maintab;
                
                const ctrlPanel = document.getElementById('controlPanel');
                const subTabs = document.getElementById('subTabContainer');
                const statusBar = document.getElementById('pushStatusBar');
                const payTabs = document.getElementById('paymentTabsContainer');
                
                if (this.activeMainTab === 'unmapped') {
                    ctrlPanel.style.display = 'flex';
                    subTabs.style.display = 'none';
                    statusBar.style.display = 'flex';
                    payTabs.style.display = 'none'; 
                } else {
                    ctrlPanel.style.display = 'flex';
                    subTabs.style.display = 'flex';
                    statusBar.style.display = 'flex';
                    payTabs.style.display = 'flex';
                }
                this.renderActiveView();
            });
        });
    }

    attachSubTabListeners() {
        document.querySelectorAll('.sub-tabs .tab').forEach(tab => {
            tab.addEventListener('click', (e) => {
                document.querySelectorAll('.sub-tabs .tab').forEach(t => t.classList.remove('active'));
                e.target.classList.add('active');
                this.activeSubTab = e.target.dataset.subtab;
                this.renderActiveView();
            });
        });
    }

    renderDynamicTabs() {
        const payContainer = document.getElementById('paymentTabsContainer');
        const mainContainer = document.getElementById('mainTabsContainer');

        let payHtml = `<button class="tab ${this.activePaymentMethod === 'all' ? 'active' : ''}" data-paytab="all">All Gateways</button>`;
        this.paymentMethods.forEach(method => {
            payHtml += `<button class="tab ${this.activePaymentMethod === method ? 'active' : ''}" data-paytab="${method}">${method}</button>`;
        });
        payContainer.innerHTML = payHtml;
        payContainer.style.display = 'flex';

        let mainHtml = `<button class="tab ${this.activeMainTab === 'all' ? 'active' : ''}" data-maintab="all">All Data</button>`;
        
        if (this.fileType === 'orders') {
            mainHtml += `<button class="tab ${this.activeMainTab === 'sales' ? 'active' : ''}" data-maintab="sales">Sales Receipts</button>`;
        } else if (this.fileType === 'payouts') {
            mainHtml += `<button class="tab ${this.activeMainTab === 'payouts' ? 'active' : ''}" data-maintab="payouts">Payouts</button>`;
            mainHtml += `<button class="tab ${this.activeMainTab === 'expenses' ? 'active' : ''}" data-maintab="expenses">Expenses</button>`;
            mainHtml += `<button class="tab ${this.activeMainTab === 'deposits' ? 'active' : ''}" data-maintab="deposits">Deposits</button>`;
        }
        
        mainHtml += `<button class="tab ${this.activeMainTab === 'unmapped' ? 'active' : ''}" data-maintab="unmapped" style="color: #e74c3c;">Mapping</button>`;
        mainContainer.innerHTML = mainHtml;

        this.attachPaymentTabListeners();
        this.attachMainTabListeners();
    }

    renderActiveView() {
        if (this.transactions.length === 0) return;
        this.updateReadyStatus();
        if (this.activeMainTab === 'unmapped') return this.renderMappingTable();
        if (this.activeSubTab === 'table') return this.renderTable();
    }

    updateReadyStatus() {
        const statusText = document.getElementById('pushStatusText');
        const progressFill = document.getElementById('pushProgressFill');
        const highVolumeBanner = document.getElementById('highVolumeBanner');
        const limitText = document.getElementById('limitText');

        if (!statusText) return;
        
        if (limitText) {
            if (this.userRole === 'super_admin' || this.userRole === 'admin') {
                limitText.innerHTML = `<strong>${this.userRole.toUpperCase()}</strong> | Unlimited Pushes`;
                limitText.style.color = "#27ae60";
            } else {
                let remaining = Math.max(0, 10 - (this.userProfile?.monthlyBatchesPushed || 0));
                limitText.innerHTML = `<strong>GUEST</strong> | ${remaining} batches left`;
                limitText.style.color = remaining <= 2 ? "#e74c3c" : "#666";
            }
        }

        if (progressFill) progressFill.style.width = '0%';
        statusText.style.color = "#2c3e50";
        statusText.style.textShadow = "none";

        if (this.activeMainTab === 'unmapped') {
            const uniqueLines = new Set(this.transactions.map(t => t.lineItem)).size;
            statusText.innerText = `Mapping Manager: Reviewing ${uniqueLines} unique line items from this upload.`;
            statusText.style.color = "#2c3e50";
            if (highVolumeBanner) highVolumeBanner.style.display = 'none';
            return;
        }

        const currentData = this.getFilteredAndPartitionedData ? this.getFilteredAndPartitionedData() : this.getFilteredData();
        const totalLines = currentData.length;
        
        let totalTxns = 0;
        const typeNames = { 'sales': 'sales receipt', 'refunds': 'refund receipt', 'expenses': 'expense', 'deposits': 'deposit', 'payouts': 'payout' };
        let typeName = typeNames[this.activeMainTab] || 'journal';

        if (this.activeSubTab === 'journal') {
            totalTxns = 1;
            typeName = 'journal entry';
        } else if (this.activeMainTab === 'payouts') {
            totalTxns = totalLines;
        } else if (this.activeMainTab !== 'all') {
            const groups = new Set();
            currentData.forEach(t => {
                const oId = t['order id'] || t.uid;
                const dateStamp = t['date/time'] || t.dateTime || 'nodate';
                const settlementId = t['settlement id'] || t.settlementId || 'nosettlement';
                groups.add(`${oId}_${dateStamp}_${settlementId}`);
            });
            totalTxns = groups.size;
        }

        if (this.activeMainTab === 'all') {
            statusText.innerText = `Status: ${totalLines} raw lines currently filtered. Please select a specific tab to push.`;
        } else {
            statusText.innerText = `${totalLines} lines for ${totalTxns} ${typeName} transactions ready to push.`;
        }
        
        if (highVolumeBanner) highVolumeBanner.style.display = totalLines > 500 ? 'block' : 'none';
    }

    updatePushProgress(linesPushed, txnsPushed, totalLines, totalTxns, typeName) {
        const statusText = document.getElementById('pushStatusText');
        const progressFill = document.getElementById('pushProgressFill');
        
        if (statusText) {
            statusText.innerText = `${linesPushed} lines for ${txnsPushed} ${typeName} transactions pushed.`;
            statusText.style.color = "#ffffff"; 
            statusText.style.textShadow = "1px 1px 3px rgba(0,0,0,0.6)"; 
        }
        
        if (progressFill && totalTxns > 0) {
            const percentage = Math.min(100, Math.round((txnsPushed / totalTxns) * 100));
            progressFill.style.width = `${percentage}%`;
        }
    }

    getFilteredData() {
        let data = this.transactions;
        
        if (this.startDate || this.endDate) {
            data = data.filter(t => {
                const d = this.formatDateStr(t.dateTime); 
                if (this.startDate && d < this.startDate) return false;
                if (this.endDate && d > this.endDate) return false;
                return true;
            });
        }

        if (this.activePaymentMethod !== 'all') {
            data = data.filter(t => t.paymentMethod === this.activePaymentMethod);
        }

        if (this.activeMainTab !== 'all' && this.activeMainTab !== 'unmapped') {
            data = data.filter(t => t.mainTabGrouping === this.activeMainTab);
        }
        return data;
    }

    async loadCategories() {
        this.categoriesDict = {};
        try {
            const defaultSnap = await getDocs(collection(db, "category"));
            defaultSnap.forEach(doc => { 
                this.categoriesDict[doc.id] = { 
                    category: doc.data().category, 
                    accountType: doc.data().accountType || "",
                    source: 'default'
                }; 
            });
        } catch (e) {}

        const qboSelect = document.getElementById('qboSelect');
        if (qboSelect && qboSelect.value && currentUser) {
            try {
                const companySnap = await getDocs(collection(db, `qbo_companies/${qboSelect.value}/category_mappings`));
                companySnap.forEach(doc => {
                    this.categoriesDict[doc.id] = {
                        category: doc.data().category,
                        accountType: doc.data().accountType || "",
                        source: 'company'
                    };
                });
            } catch (e) {}
        }
    }

    async updateCategory(lineItem, newCategory) {
        if(!newCategory || newCategory.trim() === "") return;
        try {
            await setDoc(doc(db, "category", lineItem), { lineItem: lineItem, category: newCategory }, { merge: true });
            if (!this.categoriesDict[lineItem]) this.categoriesDict[lineItem] = {};
            this.categoriesDict[lineItem].category = newCategory;
            
            this.transactions.forEach(t => { if(t.lineItem === lineItem) t.category = newCategory; });
            this.renderActiveView(); 
        } catch (e) { this.showAlert("Error updating category database.", "danger"); }
    }

    showAlert(message, type = "warning") {
        const box = document.getElementById('alertBox');
        box.innerHTML = message;
        box.className = `alert alert-${type} visible`;
    }
    hideAlert() { document.getElementById('alertBox').className = "alert"; }

    async handleFileSelect(e) {
        this.hideAlert();
        const file = e.target.files[0];
        if (!file) return;

        const qboSelect = document.getElementById('qboSelect');
        if (!qboSelect || !qboSelect.value) {
            this.showAlert("<strong>Action Required:</strong> Please connect and select a QBO account from the top right menu before uploading a file.", "danger");
            e.target.value = "";
            return;
        }

        if (file.name.toLowerCase().endsWith('.xlsx') || file.name.toLowerCase().endsWith('.xls')) {
            this.showAlert("<strong>Format Error:</strong> You uploaded an Excel workbook (.xlsx). Please save it as a <strong>CSV</strong> file before uploading.", "danger");
            e.target.value = "";
            return;
        }

        const realmId = qboSelect.value;
        const fileDocRef = doc(db, `qbo_companies/${realmId}/transactionFiles`, file.name);
        try {
            const fileDocSnap = await getDoc(fileDocRef);
            if (fileDocSnap.exists()) {
                const uploadDate = new Date(fileDocSnap.data().dateTimeUploaded).toLocaleDateString();
                const proceed = confirm(`DUPLICATE WARNING: "${file.name}" was already uploaded to this QBO Company on ${uploadDate}.\n\nProcess again?`);
                if (!proceed) { e.target.value = ""; return; }
            }
        } catch (err) {}

        Papa.parse(file, {
            header: true,
            skipEmptyLines: true,
            complete: async (results) => {
                const headers = results.meta.fields || [];
                
                if (headers.includes('Name') && headers.includes('Lineitem name') && headers.includes('Subtotal')) {
                    this.fileType = 'orders';
                    await this.logFileRecord(file, realmId);
                    await this.parseOrdersExport(results.data);
                } else if (headers.includes('Payout Date') || headers.includes('Fee') || headers.includes('Payout ID') || headers.includes('Payment Method Name')) {
                    this.fileType = 'payouts';
                    await this.logFileRecord(file, realmId);
                    await this.parsePayoutsExport(results.data);
                } else {
                    this.showAlert("<strong>Unrecognized File:</strong> Please ensure you upload the unmodified 'orders_export.csv' or 'payment_transactions_export.csv' from Shopify.", "danger");
                    e.target.value = "";
                }
            }
        });
    }

    async logFileRecord(file, realmId) {
        let status = "Local Render Only";
        if (currentUser && db.app) {
            try {
                const storage = getStorage(db.app);
                const fileRef = ref(storage, `qbo_companies/${realmId}/transactions/${file.name}`);
                await uploadBytes(fileRef, file);
                status = "Uploaded to Storage";
            } catch (e) {
                status = "Storage Failed - Bypass Used";
            }
        }
        try {
            await setDoc(doc(db, `qbo_companies/${realmId}/transactionFiles`, file.name), {
                dateTimeUploaded: new Date().toISOString(),
                uploadedBy: currentUser ? currentUser.email : "Guest",
                storageStatus: status
            });
        } catch (e) {}
    }

    // --- PARSER 1: ORDERS EXPORT ---
    async parseOrdersExport(data) {
        this.transactions = [];
        this.paymentMethods.clear();
        
        const ordersGroup = {};
        let validationErrors = [];

        data.forEach(row => {
            const orderId = row['Name'];
            if (!orderId) return;
            
            const method = row['Payment Method'] || 'Shopify Payments';
            this.paymentMethods.add(method);

            if (!ordersGroup[orderId]) {
                ordersGroup[orderId] = {
                    lines: [],
                    subtotal: this.parseAmt(row['Subtotal']),
                    total: this.parseAmt(row['Total']),
                    paymentMethod: method,
                    shipping: this.parseAmt(row['Shipping']),
                    taxes: this.parseAmt(row['Taxes']),
                    discount: this.parseAmt(row['Discount Amount']),
                    duties: this.parseAmt(row['Duties']),
                    paidAt: row['Paid at'] || row['Created at']
                };
            }
            ordersGroup[orderId].lines.push(row);
        });

        for (const [orderId, order] of Object.entries(ordersGroup)) {
            let calculatedItemTotal = 0;
            const pushType = 'sales';

            // 1. Process Core Product Line Items
            order.lines.forEach(row => {
                const qty = this.parseAmt(row['Lineitem quantity']);
                const price = this.parseAmt(row['Lineitem price']);
                calculatedItemTotal += (qty * price);

                const lineItemKey = "Order - Item Price";
                
                this.transactions.push({
                    uid: Date.now().toString(36) + Math.random().toString(36).substring(2),
                    transactionType: 'Order',
                    lineItem: lineItemKey,
                    description: row['Lineitem name'],
                    sku: row['Lineitem sku'],
                    quantity: qty,
                    rate: price,
                    totalAmount: (qty * price),
                    dateTime: order.paidAt,
                    settlementId: '',
                    orderId: orderId,
                    paymentMethod: order.paymentMethod, 
                    mainTabGrouping: pushType,          
                    qboPushType: pushType,              
                    category: (this.categoriesDict[lineItemKey] || {}).category || "",
                    selected: false
                });
            });

            // 2. Explode Shipping into its own row
            if (order.shipping !== 0) {
                const lineItemKey = "Order - Shipping";
                this.transactions.push({
                    uid: Date.now().toString(36) + Math.random().toString(36).substring(2),
                    transactionType: 'Order',
                    lineItem: lineItemKey,
                    description: 'Shipping Collected',
                    sku: 'SHIPPING',
                    quantity: 1,
                    rate: order.shipping,
                    totalAmount: order.shipping,
                    dateTime: order.paidAt,
                    settlementId: '',
                    orderId: orderId,
                    paymentMethod: order.paymentMethod, 
                    mainTabGrouping: pushType,          
                    qboPushType: pushType,              
                    category: (this.categoriesDict[lineItemKey] || {}).category || "",
                    selected: false
                });
            }

            // 3. Explode Taxes into its own row
            if (order.taxes !== 0) {
                const lineItemKey = "Order - Taxes";
                this.transactions.push({
                    uid: Date.now().toString(36) + Math.random().toString(36).substring(2),
                    transactionType: 'Order',
                    lineItem: lineItemKey,
                    description: 'Taxes Collected',
                    sku: 'TAX',
                    quantity: 1,
                    rate: order.taxes,
                    totalAmount: order.taxes,
                    dateTime: order.paidAt,
                    settlementId: '',
                    orderId: orderId,
                    paymentMethod: order.paymentMethod, 
                    mainTabGrouping: pushType,          
                    qboPushType: pushType,              
                    category: (this.categoriesDict[lineItemKey] || {}).category || "",
                    selected: false
                });
            }

            // 4. Explode Discounts into its own row (Negative Amount)
            if (order.discount !== 0) {
                const lineItemKey = "Order - Discount";
                this.transactions.push({
                    uid: Date.now().toString(36) + Math.random().toString(36).substring(2),
                    transactionType: 'Order',
                    lineItem: lineItemKey,
                    description: 'Order Discount',
                    sku: 'DISCOUNT',
                    quantity: 1,
                    rate: -Math.abs(order.discount),
                    totalAmount: -Math.abs(order.discount),
                    dateTime: order.paidAt,
                    settlementId: '',
                    orderId: orderId,
                    paymentMethod: order.paymentMethod, 
                    mainTabGrouping: pushType,          
                    qboPushType: pushType,              
                    category: (this.categoriesDict[lineItemKey] || {}).category || "",
                    selected: false
                });
            }

            // 5. Explode Duties into its own row
            if (order.duties !== 0) {
                const lineItemKey = "Order - Duties";
                this.transactions.push({
                    uid: Date.now().toString(36) + Math.random().toString(36).substring(2),
                    transactionType: 'Order',
                    lineItem: lineItemKey,
                    description: 'Duties Collected',
                    sku: 'DUTIES',
                    quantity: 1,
                    rate: order.duties,
                    totalAmount: order.duties,
                    dateTime: order.paidAt,
                    settlementId: '',
                    orderId: orderId,
                    paymentMethod: order.paymentMethod, 
                    mainTabGrouping: pushType,          
                    qboPushType: pushType,              
                    category: (this.categoriesDict[lineItemKey] || {}).category || "",
                    selected: false
                });
            }

            // AUDITOR VALIDATION: Sum(Items) + Shipping + Duties - Discount = Target Amount
            const computedAmount = calculatedItemTotal + order.shipping + order.duties - order.discount;
            let targetAmount = order.total;

            if (Math.abs((computedAmount + order.taxes) - order.total) < 0.05) {
                targetAmount = order.total - order.taxes;
            }

            const diff = Math.abs(Math.round(computedAmount * 100) - Math.round(targetAmount * 100)) / 100;
            if (diff > 0.01) {
                validationErrors.push(`Order ${orderId}: Computed (${computedAmount.toFixed(2)}) != Target (${targetAmount.toFixed(2)})`);
            }
        }

        if (validationErrors.length > 0) {
            document.getElementById('syncQboBtn').disabled = true;
            this.showAlert(`<strong>Validation Failed:</strong> Mismatch between Line Items and Total detected in the following orders. You cannot push until this is corrected in the CSV.<br><br><span style="font-size:0.8rem; font-family:monospace;">${validationErrors.join('<br>')}</span>`, "danger");
        } else {
            document.getElementById('syncQboBtn').disabled = false;
        }

        this.renderDynamicTabs();
        this.renderActiveView();
    }

    // --- PARSER 2: PAYMENT TRANSACTIONS EXPORT ---
    async parsePayoutsExport(data) {
        this.transactions = [];
        this.paymentMethods.clear();
        
        const payoutsGroup = {};

        data.forEach(row => {
            const payoutId = row['Payout ID'] || row['Order'] || 'Unassigned';
            const method = row['Payment Method Name'] || row['Payment Method'] || row['Payment Provider'] || 'Shopify Payments';
            this.paymentMethods.add(method);

            const groupKey = `${method}_${payoutId}`;

            if (!payoutsGroup[groupKey]) {
                payoutsGroup[groupKey] = { payoutId: payoutId, method: method, date: row['Payout Date'] || row['Transaction Date'], netSum: 0, lines: [] };
            }
            const net = this.parseAmt(row['Net'] || row['Amount']);
            payoutsGroup[groupKey].netSum += net;
            payoutsGroup[groupKey].lines.push(row);
        });

        for (const [groupKey, group] of Object.entries(payoutsGroup)) {
            const isPositiveNet = group.netSum >= 0;
            const pushType = isPositiveNet ? 'payouts' : 'expenses';

            group.lines.forEach(row => {
                const typeStr = row['Type'] || 'Unknown';
                const amt = this.parseAmt(row['Amount']);
                const fee = this.parseAmt(row['Fee']);
                const reversedFee = fee * -1; 

                if (amt !== 0) {
                    const liAmount = `${typeStr} - Amount`;
                    this.transactions.push({
                        uid: Date.now().toString(36) + Math.random().toString(36).substring(2),
                        transactionType: typeStr,
                        lineItem: liAmount,
                        description: `${typeStr} amount for ${group.payoutId}`,
                        quantity: 1, rate: amt, totalAmount: amt, dateTime: row['Payout Date'] || row['Transaction Date'],
                        settlementId: group.payoutId, orderId: row['Order'] || '', 
                        paymentMethod: group.method, mainTabGrouping: pushType, qboPushType: pushType,
                        category: (this.categoriesDict[liAmount] || {}).category || "", selected: false
                    });
                }

                if (fee !== 0) {
                    const liFee = `${typeStr} - Fee`;
                    this.transactions.push({
                        uid: Date.now().toString(36) + Math.random().toString(36).substring(2),
                        transactionType: typeStr,
                        lineItem: liFee,
                        description: `${typeStr} processing fee for ${group.payoutId}`,
                        quantity: 1, rate: reversedFee, totalAmount: reversedFee, dateTime: row['Payout Date'] || row['Transaction Date'],
                        settlementId: group.payoutId, orderId: row['Order'] || '', 
                        paymentMethod: group.method, mainTabGrouping: pushType, qboPushType: pushType,
                        category: (this.categoriesDict[liFee] || {}).category || "", selected: false
                    });
                }
            });

            if (!isPositiveNet && group.netSum !== 0) {
                const liDeposit = `Payout Reversal Deposit`;
                const absNet = Math.abs(group.netSum);
                this.transactions.push({
                    uid: Date.now().toString(36) + Math.random().toString(36).substring(2),
                    transactionType: 'Reversal Offset',
                    lineItem: liDeposit,
                    description: `Bank draw for negative payout ${group.payoutId}`,
                    quantity: 1, rate: absNet, totalAmount: absNet, dateTime: group.date,
                    settlementId: group.payoutId, orderId: '', 
                    paymentMethod: group.method, mainTabGrouping: 'deposits', qboPushType: 'deposits',
                    category: (this.categoriesDict[liDeposit] || {}).category || "", selected: false
                });
            }
        }

        document.getElementById('syncQboBtn').disabled = false;
        this.renderDynamicTabs();
        this.renderActiveView();
    }

    renderTable() {
        const currentData = this.getFilteredData();
        let html = `
            <div style="margin-bottom: 10px; display:flex; justify-content:space-between; align-items:center;">
                <button class="btn danger" onclick="window.deleteSelected()">Delete Selected Rows</button>
                <span style="font-size:0.9rem; color:#d35400; font-weight:bold;">⚠️ Checked rows are ignored and will NOT be pushed to QBO.</span>
                <span style="font-size:0.9rem; color:#666;">Showing ${currentData.length} rows</span>
            </div>
            <div class="table-responsive">
            <table><thead><tr>
                <th style="width: 40px;"><input type="checkbox" id="selectAllCb" onchange="window.toggleSelectAll(this.checked)"></th>
                <th>Type</th>
                <th>Line Item</th>
                <th>Category</th>
                <th>Description</th>
                <th>SKU</th>
                <th style="text-align: right;">Qty</th>
                <th style="text-align: right;">Rate</th>
                <th style="text-align: right;">Total</th>
                <th>Date Paid</th>
                <th>Gateway</th>
                <th>Order/Settlement ID</th>
            </tr></thead><tbody>
        `;

        if (currentData.length === 0) {
            html += `<tr><td colspan="12" style="text-align:center;">No data matches the current filters.</td></tr>`;
        }

        currentData.forEach((t) => {
            let catDisplay = t.category;
            // Map table category from live data if possible
            const liveMatch = this.qboAccounts.find(a => a.name.toLowerCase() === t.lineItem.toLowerCase());
            if (liveMatch && !t.category) {
                catDisplay = liveMatch.name;
                t.category = liveMatch.name;
            } else if (!t.category) {
                catDisplay = `<input type="text" class="cat-input" placeholder="Add Category..." onblur="window.updateCat('${t.lineItem}', this.value)"><span class="text-danger"> Missing</span>`;
            }

            html += `<tr>
                <td><input type="checkbox" class="row-checkbox" data-uid="${t.uid}" ${t.selected ? 'checked' : ''} onchange="window.toggleRow('${t.uid}', this.checked)"></td>
                <td>${t.transactionType}</td>
                <td><strong>${t.lineItem}</strong></td>
                <td>${catDisplay}</td>
                <td><span style="font-size: 0.8rem;">${t.description}</span></td>
                <td>${t.sku || ''}</td>
                <td style="text-align: right;">${t.quantity}</td>
                <td style="text-align: right;">${t.rate.toFixed(2)}</td>
                <td style="text-align: right; font-weight: bold;">${t.totalAmount.toFixed(2)}</td>
                <td>${this.formatDateStr(t.dateTime)}</td>
                <td><span style="font-size: 0.8rem; color:#888;">${t.paymentMethod}</span></td>
                <td>${t.orderId || t.settlementId}</td>
            </tr>`;
        });

        html += `</tbody></table></div>`;
        document.getElementById('tabContent').innerHTML = html;

        window.updateCat = (line, val) => this.updateCategory(line, val);
        
        window.toggleSelectAll = (checked) => {
            currentData.forEach(t => {
                const masterRow = this.transactions.find(m => m.uid === t.uid);
                if (masterRow) masterRow.selected = checked;
            });
            document.querySelectorAll('.row-checkbox').forEach(cb => cb.checked = checked);
        };
        
        window.toggleRow = (uid, checked) => {
            const masterRow = this.transactions.find(t => t.uid === uid);
            if (masterRow) masterRow.selected = checked;
            const allChecked = currentData.length > 0 && currentData.every(t => t.selected);
            const selectAllCb = document.getElementById('selectAllCb');
            if (selectAllCb) selectAllCb.checked = allChecked;
        };

        window.deleteSelected = () => {
            this.transactions = this.transactions.filter(t => !t.selected);
            this.renderActiveView();
        };
    }

    renderMappingTable() {
        const fullAccountTypes = [
            "Bank", "Accounts Receivable", "Other Current Asset", "Fixed Asset", "Other Asset", 
            "Accounts Payable", "Credit Card", "Other Current Liability", "Long Term Liability", 
            "Equity", "Income", "Other Income", "Cost of Goods Sold", "Expense", "Other Expense"
        ];

        const uniqueLineItems = new Set(this.transactions.map(t => t.lineItem));

        let html = `
            <div style="margin-bottom: 10px;">
                <span style="font-size:0.9rem; color:#666;">Showing all ${uniqueLineItems.size} unique line items required for this upload. Data is fetched directly from QBO.</span>
            </div>
            <div class="table-responsive">
            <table class="costing-table data-table" style="width:100% !important; min-width: 1000px !important;"><thead><tr>
                <th style="text-align:left; width:20%;">Line Item</th>
                <th style="text-align:left; width:15%;">Item Type</th>
                <th style="text-align:left; width:25%;">Target QBO Account</th>
                <th style="text-align:left; width:20%;">Account Type</th>
                <th style="text-align:center; width:10%;">Status</th>
                <th style="text-align:center; width:10%;">Action</th>
            </tr></thead><tbody>
        `;

        if (uniqueLineItems.size === 0) {
            html += `<tr><td colspan="6" style="text-align:center; padding: 2rem; color: #666;">No line items found. Upload a CSV.</td></tr>`;
        }

        const isGuest = this.userRole === 'guest';
        let i = 0;

        uniqueLineItems.forEach(lineItem => {
            const itemMatch = this.qboItems.find(item => item.name.toLowerCase() === lineItem.toLowerCase());
            const accMatch = this.qboAccounts.find(acc => acc.name.toLowerCase() === lineItem.toLowerCase());

            const itemInQbo = !!itemMatch;
            const accInQbo = !!accMatch;
            const isFullyMapped = itemInQbo && accInQbo;

            let accDropdownHtml = `<select id="unmap-cat-${i}" style="padding:0.4rem; width:100%; box-sizing: border-box;" onchange="window.toggleNewAccountInput(${i}, this.value)">`;
            accDropdownHtml += `<option value="">Select Existing QBO Account...</option>`;
            accDropdownHtml += `<option value="ADD_NEW" style="font-weight:bold; color:var(--btn-bg);">+ Create New Account</option>`;
            this.qboAccounts.forEach(acc => {
                const selected = accInQbo && acc.id === accMatch.id ? 'selected' : '';
                accDropdownHtml += `<option value="${acc.id}" data-name="${acc.name}" data-type="${acc.type}" ${selected}>${acc.name} (${acc.type})</option>`;
            });
            accDropdownHtml += `</select>`;
            accDropdownHtml += `<input type="text" id="new-cat-name-${i}" placeholder="Enter new account name" style="display:none; margin-top:5px; padding:0.4rem; width:100%; box-sizing: border-box;" value="${lineItem}">`;

            // Default Type Logic
            let typeDropdownHtml = `<select id="unmap-type-${i}" style="padding:0.4rem; width:100%; box-sizing: border-box;" ${accInQbo ? 'disabled' : ''}>`;
            let defaultType = (lineItem.includes('Price') || lineItem.includes('Shipping')) ? 'Income' : 'Expense';
            fullAccountTypes.forEach(t => {
                const selected = accMatch && accMatch.type === t ? 'selected' : (t === defaultType ? 'selected' : '');
                typeDropdownHtml += `<option value="${t}" ${selected}>${t}</option>`;
            });
            typeDropdownHtml += `</select>`;

            let defaultItemType = (lineItem.includes('Price')) ? 'NonInventory' : 'Service';
            if (itemMatch) defaultItemType = itemMatch.type;
            
            let statusHtml = '';
            if (itemInQbo) statusHtml += `<div class="qbo-badge">✅ Item in QBO</div>`;
            if (accInQbo) statusHtml += `<div class="qbo-badge" style="margin-top:3px;">✅ Account in QBO</div>`;
            if (!itemInQbo && !accInQbo) statusHtml = `<span style="color:#e74c3c; font-size:0.8rem;">Unmapped</span>`;

            const isDisabled = isFullyMapped || isGuest;

            html += `<tr>
                <td style="white-space:normal; word-wrap: break-word;"><strong>${lineItem}</strong></td>
                <td>
                    <select id="item-type-${i}" style="padding:0.4rem; width:100%; box-sizing: border-box;" ${itemInQbo ? 'disabled' : ''}>
                        <option value="NonInventory" ${defaultItemType === 'NonInventory' ? 'selected' : ''}>Non-Inventory</option>
                        <option value="Service" ${defaultItemType === 'Service' ? 'selected' : ''}>Service</option>
                        <option value="Inventory" ${defaultItemType === 'Inventory' ? 'selected' : ''}>Inventory</option>
                        <option value="Bundle" ${defaultItemType === 'Bundle' ? 'selected' : ''}>Bundle</option>
                    </select>
                </td>
                <td>${accDropdownHtml}</td>
                <td>${typeDropdownHtml}</td>
                <td style="text-align:center;">${statusHtml}</td>
                <td style="text-align:center; display:flex; gap:5px; justify-content:center;">
                    <button class="btn" style="background:${isDisabled ? '#95a5a6' : '#27ae60'}; color:white; font-weight:bold; padding:0.4rem 0.8rem; border-radius:3px; border:none; cursor:${isDisabled ? 'not-allowed' : 'pointer'};" onclick="window.pushToQboMapping('${lineItem}', ${i})" ${isDisabled ? 'disabled' : ''} title="${isGuest ? 'Available to Admins only' : ''}">Save to QBO</button>
                </td>
            </tr>`;
            i++;
        });

        html += `</tbody></table></div>`;
        document.getElementById('tabContent').innerHTML = html;

        window.toggleNewAccountInput = (index, val) => {
            const input = document.getElementById(`new-cat-name-${index}`);
            const typeDropdown = document.getElementById(`unmap-type-${index}`);
            if (val === 'ADD_NEW') {
                input.style.display = 'block';
                typeDropdown.disabled = false;
            } else {
                input.style.display = 'none';
                typeDropdown.disabled = val !== '';
                
                if (val !== '') {
                    const sel = document.getElementById(`unmap-cat-${index}`);
                    const selectedType = sel.options[sel.selectedIndex].dataset.type;
                    if (selectedType) typeDropdown.value = selectedType;
                }
            }
        };

        window.pushToQboMapping = async (lineItem, index) => {
            const itemTypeVal = document.getElementById(`item-type-${index}`).value;
            const accSelect = document.getElementById(`unmap-cat-${index}`);
            const accDropdownVal = accSelect.value;
            const newAccName = document.getElementById(`new-cat-name-${index}`).value.trim();
            const accTypeVal = document.getElementById(`unmap-type-${index}`).value;
            const btn = event.target;

            const qboSelect = document.getElementById('qboSelect');
            if (!qboSelect || !qboSelect.value) return this.showAlert("Please connect a QBO account first.", "warning");

            let targetAccountId = accDropdownVal;
            let finalAccName = "";

            if (accDropdownVal === 'ADD_NEW') {
                if (!newAccName) return this.showAlert("Please enter a name for the new account.", "danger");
                finalAccName = newAccName;
            } else if (accDropdownVal === '') {
                return this.showAlert("Please select an existing account or choose Add New.", "danger");
            } else {
                finalAccName = accSelect.options[accSelect.selectedIndex].dataset.name;
            }

            btn.innerText = "Syncing..."; btn.disabled = true;
            const realmId = qboSelect.value;

            try {
                if (accDropdownVal === 'ADD_NEW') {
                    const getOrCreateQboAccount = httpsCallable(functions, 'getOrCreateQboAccount');
                    const accRes = await getOrCreateQboAccount({ 
                        accountName: finalAccName, 
                        realmId: realmId, 
                        accountType: accTypeVal 
                    });
                    targetAccountId = accRes.data.id;
                }

                const itemMatch = this.qboItems.find(item => item.name.toLowerCase() === lineItem.toLowerCase());
                if (!itemMatch) {
                    const createQboItem = httpsCallable(functions, 'createQboItem');
                    await createQboItem({
                        realmId: realmId,
                        itemName: lineItem,
                        itemType: itemTypeVal,
                        accountId: targetAccountId,
                        isIncome: (accTypeVal === 'Income' || accTypeVal === 'Other Income')
                    });
                }

                this.showAlert(`Successfully synced "${lineItem}" with QuickBooks!`, "success");
                
                await this.loadLiveQboData();
                this.renderActiveView(); 

            } catch (err) {
                this.showAlert(err.message, "danger");
                btn.innerText = "Save to QBO"; 
                btn.disabled = (this.userRole === 'guest');
            }
        };
    }

    async handlePushToQbo() {
        if (this.userRole === 'guest' && this.userProfile.monthlyBatchesPushed >= 10) {
            return this.showAlert("Monthly push limit reached (10/10). Please subscribe in the UI to continue pushing data.", "danger");
        }

        if (this.activeMainTab === 'all' || this.activePaymentMethod === 'all') return this.showAlert("Please select a specific Payment Method AND a specific Transaction tab (Sales, Payouts, etc.) to push.", "warning");
        const qboSelect = document.getElementById('qboSelect');
        if (!qboSelect || !qboSelect.value) return this.showAlert("Please connect and select a QBO account first.", "warning");

        const visibleData = this.getFilteredData().filter(t => !t.selected);
        if (visibleData.length === 0) return this.showAlert("No unchecked transactions in the current view to push.", "warning");

        const pushBtn = document.getElementById('syncQboBtn');
        const statusText = document.getElementById('pushStatusText');
        const originalText = pushBtn.innerText;
        
        pushBtn.innerText = "Provisioning & Pushing...";
        pushBtn.disabled = true;
        
        if(statusText) {
            statusText.innerText = "Initializing push connection...";
            statusText.style.color = "#ffffff"; 
            statusText.style.textShadow = "1px 1px 3px rgba(0,0,0,0.6)";
        }

        let wakeLock = null;
        try {
            if ('wakeLock' in navigator) {
                wakeLock = await navigator.wakeLock.request('screen');
            }
        } catch (err) {}

        try {
            const config = {
                realmId: qboSelect.value,
                depositAccountName: this.depositAccount && this.depositAccount.trim() !== "" ? this.depositAccount : "Shopify Clearing",
                functions: functions,
                endDate: this.endDate,
                batchId: `batch_${Date.now()}` 
            };

            let pushedIds = [];

            if (this.activeSubTab === 'table') {
                if (this.fileType === 'orders') {
                    const salesData = visibleData.filter(t => t.qboPushType === 'sales');
                    if (salesData.length > 0) pushedIds = pushedIds.concat(await pushShopifySalesReceipts(salesData, config, this));
                    
                } else if (this.fileType === 'payouts') {
                    const payoutsData = visibleData.filter(t => t.qboPushType === 'payouts');
                    const expensesData = visibleData.filter(t => t.qboPushType === 'expenses');
                    const depositsData = visibleData.filter(t => t.qboPushType === 'deposits');

                    if (payoutsData.length > 0) pushedIds = pushedIds.concat(await pushShopifyPayouts(payoutsData, config, this));
                    if (expensesData.length > 0) pushedIds = pushedIds.concat(await pushShopifyExpenses(expensesData, config, this));
                    if (depositsData.length > 0) pushedIds = pushedIds.concat(await pushShopifyDeposits(depositsData, config, this));
                }
            } else {
                this.showAlert("Journal view pushing for Shopify is currently under construction.", "info");
                throw new Error("Journal View not yet supported for Shopify.");
            }

            if (pushedIds && pushedIds.length > 0) {
                await setDoc(doc(db, `qbo_companies/${config.realmId}/transPushedToQB`, config.batchId), {
                    timestamp: new Date().toISOString(),
                    realmId: config.realmId,
                    tab: this.activeMainTab,
                    view: this.activeSubTab,
                    qboIds: pushedIds,
                    pushedBy: currentUser.email
                });

                if (this.userRole === 'guest') {
                    this.userProfile.monthlyBatchesPushed++;
                    await setDoc(doc(db, "users", currentUser.uid, "profile", "billing"), {
                        monthlyBatchesPushed: this.userProfile.monthlyBatchesPushed
                    }, { merge: true });
                    this.updateReadyStatus(); 
                }
                
                if (statusText) {
                    statusText.innerText = `Push completed successfully! ${pushedIds.length} transactions saved to QBO.`;
                }
            } else {
                if (statusText) {
                    statusText.innerText = `All selected transactions were identified as duplicates and skipped.`;
                    statusText.style.color = "#e67e22"; 
                    statusText.style.textShadow = "none";
                    document.getElementById('pushProgressFill').style.width = '0%';
                }
            }
        } catch (error) {
            console.error("Push failed:", error);
            this.showAlert(error.message || "Failed to push to QBO. See console.", "danger");
            if(statusText) {
                statusText.innerText = "Status: Push failed. Check alerts.";
                statusText.style.color = "#e74c3c";
                statusText.style.textShadow = "none";
                document.getElementById('pushProgressFill').style.width = '0%';
            }
        } finally {
            if (wakeLock !== null) wakeLock.release().catch(()=>{});
            pushBtn.innerText = originalText;
            pushBtn.disabled = false;
        }
    }

    async loadBatchHistory() {
        const qboSelect = document.getElementById('qboSelect');
        if (!qboSelect || !qboSelect.value) return;
        const container = document.getElementById('historyTableContainer');
        container.innerHTML = "<p>Loading history...</p>";

        try {
            const snap = await getDocs(collection(db, `qbo_companies/${qboSelect.value}/transPushedToQB`));
            let batches = [];
            snap.forEach(doc => batches.push({ id: doc.id, ...doc.data() }));
            batches.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

            if (batches.length === 0) {
                container.innerHTML = "<p>No batches pushed yet.</p>";
                return;
            }

            let html = `
                <table style="width: 100%; border-collapse: collapse; text-align: left; font-size: 0.9rem;">
                    <thead style="background: #f8f9fa;">
                        <tr>
                            <th style="padding: 10px; border-bottom: 2px solid #ddd;">Date Pushed</th>
                            <th style="padding: 10px; border-bottom: 2px solid #ddd;">Tab / View</th>
                            <th style="padding: 10px; border-bottom: 2px solid #ddd;">Items Created</th>
                            <th style="padding: 10px; border-bottom: 2px solid #ddd; text-align: center;">Action</th>
                        </tr>
                    </thead>
                    <tbody>
            `;

            batches.forEach(b => {
                const dateStr = new Date(b.timestamp).toLocaleString();
                const itemCount = b.qboIds ? b.qboIds.length : 0;
                
                html += `
                    <tr>
                        <td style="padding: 10px; border-bottom: 1px solid #eee;">
                            <strong>${dateStr}</strong><br>
                            <span style="font-size:0.75rem; color:#888;">${b.id} | by ${b.pushedBy || 'Unknown'}</span>
                        </td>
                        <td style="padding: 10px; border-bottom: 1px solid #eee; text-transform: capitalize;">
                            ${b.tab} <span style="color:#aaa;">(${b.view})</span>
                        </td>
                        <td style="padding: 10px; border-bottom: 1px solid #eee;">${itemCount}</td>
                        <td style="padding: 10px; border-bottom: 1px solid #eee; text-align: center;">
                            <button onclick="window.deleteBatch('${b.id}', '${b.realmId}')" class="btn danger" style="padding: 0.3rem 0.6rem; font-size: 0.8rem;">Reverse / Delete</button>
                        </td>
                    </tr>
                `;
            });

            html += `</tbody></table>`;
            container.innerHTML = html;

        } catch (error) {
            console.error("Failed to load history", error);
            container.innerHTML = `<p class="text-danger">Error loading batch history.</p>`;
        }
    }

    async handleDeleteBatch(batchId, realmId) {
        if (!confirm("Are you sure you want to delete this entire batch from QuickBooks? This cannot be undone.")) return;
        
        try {
            const deleteQboBatch = httpsCallable(functions, 'deleteQboBatch');
            document.getElementById('historyTableContainer').innerHTML = "<p>Deleting batch from QuickBooks... Please wait.</p>";
            
            const res = await deleteQboBatch({ batchId: batchId, realmId: realmId });
            
            alert(`Success: ${res.data.deletedCount} transactions were removed from QuickBooks.`);
            this.loadBatchHistory(); 
        } catch (err) {
            alert(`Failed to delete batch: ${err.message}`);
            this.loadBatchHistory(); 
        }
    }
}
