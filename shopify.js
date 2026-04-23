import { db, functions } from './auth.js'; 
import { collection, doc, getDoc, setDoc, getDocs } from "https://www.gstatic.com/firebasejs/12.11.0/firebase-firestore.js";
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
        
        this.depositAccount = "Shopify Clearing"; 
        this.startDate = "";
        this.endDate = "";
        this.activePaymentMethod = "all"; // New State for Payment Method Tab
        this.activeMainTab = "all";       // State for Sales/Payouts/Expenses Tab
        this.activeSubTab = "table";      // State for Table/Journal Tab
        
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
            </style>
            
            <div class="container" style="padding-top: 0.25rem;">
                <h2 style="margin-top: 0; margin-bottom: 0.25rem; font-size: 1.4rem;">VilSync: Shopify Integrator</h2>
                <p style="color: #666; font-size: 0.85rem; margin-top: 0;">Upload your <strong>orders_export.csv</strong> (for Sales Receipts) or <strong>payment_transactions_export.csv</strong> (for Payouts & Fees).</p>
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
                    <p style="padding: 2rem; text-align: center; color: #7f8c8d;">Awaiting Shopify Export CSV...</p>
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
                    payTabs.style.display = 'none'; // Unmapped ignores payment methods
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

        // 1. Render Payment Method Tabs
        let payHtml = `<button class="tab ${this.activePaymentMethod === 'all' ? 'active' : ''}" data-paytab="all">All Gateways</button>`;
        this.paymentMethods.forEach(method => {
            payHtml += `<button class="tab ${this.activePaymentMethod === method ? 'active' : ''}" data-paytab="${method}">${method}</button>`;
        });
        payContainer.innerHTML = payHtml;
        payContainer.style.display = 'flex';

        // 2. Render Accounting Tabs based on File Type
        let mainHtml = `<button class="tab ${this.activeMainTab === 'all' ? 'active' : ''}" data-maintab="all">All Data</button>`;
        
        if (this.fileType === 'orders') {
            mainHtml += `<button class="tab ${this.activeMainTab === 'sales' ? 'active' : ''}" data-maintab="sales">Sales Receipts</button>`;
        } else if (this.fileType === 'payouts') {
            mainHtml += `<button class="tab ${this.activeMainTab === 'payouts' ? 'active' : ''}" data-maintab="payouts">Payouts</button>`;
            mainHtml += `<button class="tab ${this.activeMainTab === 'expenses' ? 'active' : ''}" data-maintab="expenses">Expenses</button>`;
            mainHtml += `<button class="tab ${this.activeMainTab === 'deposits' ? 'active' : ''}" data-maintab="deposits">Deposits</button>`;
        }
        
        mainHtml += `<button class="tab ${this.activeMainTab === 'unmapped' ? 'active' : ''}" data-maintab="unmapped" style="color: #e74c3c;">Unmapped</button>`;
        mainContainer.innerHTML = mainHtml;

        this.attachPaymentTabListeners();
        this.attachMainTabListeners();
    }

    renderActiveView() {
        if (this.transactions.length === 0) return;
        this.updateReadyStatus();
        if (this.activeMainTab === 'unmapped') return this.renderUnmappedTable();
        if (this.activeSubTab === 'table') return this.renderTable();
        // this.renderJournal(); // Can be built out later if needed for Shopify
    }

    updateReadyStatus() {
        const statusText = document.getElementById('pushStatusText');
        const progressFill = document.getElementById('pushProgressFill');
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
            const unmappedCount = new Set(this.transactions.filter(t => !t.category).map(t => t.lineItem)).size;
            statusText.innerText = `${unmappedCount} unmapped items to resolve.`;
            statusText.style.color = "#e74c3c";
            return;
        }

        const currentData = this.getFilteredData();
        statusText.innerText = `Status: ${currentData.length} lines ready in current view.`;
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
        const snap = await getDocs(collection(db, "category"));
        snap.forEach(doc => { 
            this.categoriesDict[doc.id] = { category: doc.data().category, accountType: doc.data().accountType || "" }; 
        });
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

        Papa.parse(file, {
            header: true,
            skipEmptyLines: true,
            complete: async (results) => {
                const headers = results.meta.fields || [];
                
                if (headers.includes('Name') && headers.includes('Lineitem name') && headers.includes('Subtotal')) {
                    this.fileType = 'orders';
                    await this.parseOrdersExport(results.data);
                } else if (headers.includes('Payout Date') || headers.includes('Fee') || headers.includes('Payout ID') || headers.includes('Payment Method Name')) {
                    this.fileType = 'payouts';
                    await this.parsePayoutsExport(results.data);
                } else {
                    this.showAlert("<strong>Unrecognized File:</strong> Please ensure you upload the unmodified 'orders_export.csv' or 'payment_transactions_export.csv' from Shopify.", "danger");
                    e.target.value = "";
                }
            }
        });
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
                    paymentMethod: method,
                    shipping: this.parseAmt(row['Shipping']),
                    taxes: this.parseAmt(row['Taxes']),
                    discount: this.parseAmt(row['Discount Amount']),
                    paidAt: row['Paid at'] || row['Created at']
                };
            }
            ordersGroup[orderId].lines.push(row);
        });

        for (const [orderId, order] of Object.entries(ordersGroup)) {
            let calculatedLineTotal = 0;
            const pushType = 'sales';

            order.lines.forEach(row => {
                const qty = this.parseAmt(row['Lineitem quantity']);
                const price = this.parseAmt(row['Lineitem price']);
                calculatedLineTotal += (qty * price);

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
                    shipping: order.shipping,
                    taxes: order.taxes,
                    discount: order.discount,
                    selected: false
                });
            });

            const diff = Math.abs(Math.round(calculatedLineTotal * 100) - Math.round(order.subtotal * 100)) / 100;
            if (diff > 0.01) {
                validationErrors.push(`Order ${orderId}: Computed Lines ($${calculatedLineTotal.toFixed(2)}) != Subtotal ($${order.subtotal.toFixed(2)})`);
            }
        }

        if (validationErrors.length > 0) {
            document.getElementById('syncQboBtn').disabled = true;
            this.showAlert(`<strong>Validation Failed:</strong> Mismatch between Line Items and Subtotal detected in the following orders. You cannot push until this is corrected in the CSV.<br><br><span style="font-size:0.8rem; font-family:monospace;">${validationErrors.join('<br>')}</span>`, "danger");
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
            if (!t.category) {
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

    renderUnmappedTable() {
        const unmappedData = [];
        const seen = new Set();
        
        this.transactions.forEach(t => {
            if (!t.category && !seen.has(t.lineItem)) {
                seen.add(t.lineItem);
                unmappedData.push(t);
            }
        });

        let html = `
            <div style="margin-bottom: 10px;">
                <span style="font-size:0.9rem; color:#666;">Showing ${unmappedData.length} unique unmapped line items.</span>
            </div>
            <div class="table-responsive">
            <table><thead><tr>
                <th>Line Item</th>
                <th>Category Name (QBO Account)</th>
                <th>Account Type</th>
                <th>Description</th>
                <th style="text-align:center;">Action</th>
            </tr></thead><tbody>
        `;

        if (unmappedData.length === 0) {
            html += `<tr><td colspan="5" style="text-align:center; padding: 2rem; color: #27ae60; font-weight: bold;">All line items are successfully mapped!</td></tr>`;
        }

        unmappedData.forEach((t, i) => {
            html += `<tr>
                <td><strong>${t.lineItem}</strong></td>
                <td><input type="text" id="unmap-cat-${i}" placeholder="E.g., Shopify Sales, Gateway Fees..." style="padding:0.4rem; width:100%; box-sizing: border-box;"></td>
                <td>
                    <select id="unmap-type-${i}" style="padding:0.4rem; width:100%; box-sizing: border-box;">
                        <option value="Income">Income</option>
                        <option value="Expense" selected>Expense</option>
                        <option value="Bank">Bank / Clearing</option>
                        <option value="OtherCurrentAsset">Other Current Asset</option>
                        <option value="CostOfGoodsSold">Cost of Goods Sold</option>
                    </select>
                </td>
                <td><input type="text" id="unmap-desc-${i}" placeholder="Optional internal description" style="padding:0.4rem; width:100%; box-sizing: border-box;"></td>
                <td style="text-align:center;">
                    <button class="btn" style="background:#27ae60; color:white; font-weight:bold; padding:0.4rem 1rem;" onclick="window.pushAndSaveUnmapped('${t.lineItem}', ${i})">Push to QBO & Save</button>
                </td>
            </tr>`;
        });

        html += `</tbody></table></div>`;
        document.getElementById('tabContent').innerHTML = html;

        window.pushAndSaveUnmapped = async (lineItem, index) => {
            const catVal = document.getElementById(`unmap-cat-${index}`).value.trim();
            const typeVal = document.getElementById(`unmap-type-${index}`).value;
            const descVal = document.getElementById(`unmap-desc-${index}`).value.trim();
            const btn = event.target;

            if (!catVal) { 
                this.showAlert("Please enter a Category Name (QBO Account Name).", "danger"); 
                return; 
            }
            
            const qboSelect = document.getElementById('qboSelect');
            if (!qboSelect || !qboSelect.value) {
                this.showAlert("Please connect and select a QBO account from the top menu first.", "warning");
                return;
            }

            btn.innerText = "Pushing...";
            btn.disabled = true;

            try {
                const getOrCreateQboAccount = httpsCallable(functions, 'getOrCreateQboAccount');
                
                await getOrCreateQboAccount({
                    accountName: catVal,
                    realmId: qboSelect.value,
                    accountType: typeVal,
                    description: descVal
                });

                await setDoc(doc(db, "category", lineItem), {
                    lineItem: lineItem,
                    category: catVal,
                    accountType: typeVal,
                    description: descVal
                }, { merge: true });

                if (!this.categoriesDict[lineItem]) this.categoriesDict[lineItem] = {};
                this.categoriesDict[lineItem].category = catVal;
                this.categoriesDict[lineItem].accountType = typeVal;
                
                this.transactions.forEach(t => {
                    if (t.lineItem === lineItem) t.category = catVal;
                });

                this.showAlert(`Successfully created "${catVal}" as ${typeVal} in QBO and mapped it!`, "success");
                this.renderActiveView(); 

            } catch (err) {
                this.showAlert(err.message, "danger");
                btn.innerText = "Push to QBO & Save";
                btn.disabled = false;
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
        try { if ('wakeLock' in navigator) wakeLock = await navigator.wakeLock.request('screen'); } catch (err) {}

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
                await setDoc(doc(db, "users", currentUser.uid, "transPushedToQB", config.batchId), {
                    timestamp: new Date().toISOString(),
                    realmId: config.realmId,
                    tab: this.activeMainTab,
                    view: this.activeSubTab,
                    qboIds: pushedIds
                });

                if (this.userRole === 'guest') {
                    this.userProfile.monthlyBatchesPushed++;
                    await setDoc(doc(db, "users", currentUser.uid, "profile", "billing"), {
                        monthlyBatchesPushed: this.userProfile.monthlyBatchesPushed
                    }, { merge: true });
                    this.updateReadyStatus(); 
                }
                
                if (statusText) statusText.innerText = `Push completed successfully! ${pushedIds.length} transactions saved to QBO.`;
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
        const container = document.getElementById('historyTableContainer');
        container.innerHTML = "<p>Loading history...</p>";

        try {
            const snap = await getDocs(collection(db, "users", currentUser.uid, "transPushedToQB"));
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
                            <span style="font-size:0.75rem; color:#888;">${b.id}</span>
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
