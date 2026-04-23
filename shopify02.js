import { db, functions } from './auth.js'; 
import { collection, doc, getDoc, setDoc, getDocs } from "https://www.gstatic.com/firebasejs/12.11.0/firebase-firestore.js";
import { httpsCallable } from "https://www.gstatic.com/firebasejs/12.11.0/firebase-functions.js";
import { getStorage, ref, uploadBytes } from "https://www.gstatic.com/firebasejs/12.11.0/firebase-storage.js";
import { currentUser } from './app.js';

// We will build these next based on your Amazon handlers
import { pushShopifySalesReceipts } from './shopifyTransHandlers/salesReceipt.js';
import { pushShopifyRefunds } from './shopifyTransHandlers/refundReceipt.js';
import { pushShopifyExpenses } from './shopifyTransHandlers/expense.js';
import { pushShopifyDeposits } from './shopifyTransHandlers/deposit.js';

export default class Shopify {
    constructor() {
        this.transactions = [];
        this.categoriesDict = {};
        this.paymentMethods = new Set();
        this.fileType = null; // 'orders' or 'payouts'
        
        this.depositAccount = "Shopify Clearing"; 
        this.startDate = "";
        this.endDate = "";
        this.activeMainTab = "all";
        this.activeSubTab = "table";
        
        this.userRole = 'guest'; 
        this.userProfile = null;
    }

    parseAmt(val) {
        if (val === undefined || val === null) return 0;
        return parseFloat(String(val).replace(/,/g, '')) || 0;
    }

    formatDateStr(dateStr) {
        if (!dateStr) return new Date().toISOString().split('T')[0];
        const d = new Date(dateStr);
        if (isNaN(d.getTime())) return new Date().toISOString().split('T')[0];
        return d.toISOString().split('T')[0];
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
                </div>

                <div id="dynamicTabsContainer" class="tabs main-tabs desktop-scroll-row" style="border-bottom: 2px solid #27ae60; margin-bottom: 0; gap: 0;">
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

        this.attachSubTabListeners();
    }

    async checkUserRoleAndLimits() {
        if (!currentUser) {
            document.getElementById('tabContent').innerHTML = `<p style="padding: 2rem; text-align: center; color: #7f8c8d;">Please log in to continue.</p>`;
            return;
        }
        this.userRole = 'admin'; // Simplified for integration scaffolding
        this.updateReadyStatus();
    }

    attachMainTabListeners() {
        document.querySelectorAll('.main-tabs .tab').forEach(tab => {
            tab.addEventListener('click', (e) => {
                document.querySelectorAll('.main-tabs .tab').forEach(t => t.classList.remove('active'));
                e.target.classList.add('active');
                this.activeMainTab = e.target.dataset.maintab;
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
        const container = document.getElementById('dynamicTabsContainer');
        let html = `<button class="tab ${this.activeMainTab === 'all' ? 'active' : ''}" data-maintab="all">All Data</button>`;
        
        if (this.fileType === 'orders') {
            this.paymentMethods.forEach(method => {
                html += `<button class="tab ${this.activeMainTab === method ? 'active' : ''}" data-maintab="${method}">${method}</button>`;
            });
        } else if (this.fileType === 'payouts') {
            html += `<button class="tab ${this.activeMainTab === 'refunds' ? 'active' : ''}" data-maintab="refunds">Refunds</button>`;
            html += `<button class="tab ${this.activeMainTab === 'expenses' ? 'active' : ''}" data-maintab="expenses">Fees & Expenses</button>`;
            html += `<button class="tab ${this.activeMainTab === 'deposits' ? 'active' : ''}" data-maintab="deposits">Net Deposits</button>`;
        }
        
        html += `<button class="tab ${this.activeMainTab === 'unmapped' ? 'active' : ''}" data-maintab="unmapped" style="color: #e74c3c;">Unmapped</button>`;
        container.innerHTML = html;
        this.attachMainTabListeners();
    }

    renderActiveView() {
        if (this.transactions.length === 0) return;
        this.updateReadyStatus();
        if (this.activeMainTab === 'unmapped') return this.renderUnmappedTable();
        if (this.activeSubTab === 'table') return this.renderTable();
        // this.renderJournal(); // Can be added later
    }

    updateReadyStatus() {
        const statusText = document.getElementById('pushStatusText');
        if (!statusText) return;
        
        const currentData = this.getFilteredData();
        statusText.innerText = `Status: ${currentData.length} lines ready in current view.`;
        statusText.style.color = "#2c3e50";
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
                } else if (headers.includes('Payout Date') || headers.includes('Fee') || headers.includes('Payout ID')) {
                    this.fileType = 'payouts';
                    await this.parsePayoutsExport(results.data);
                } else {
                    this.showAlert("<strong>Unrecognized File:</strong> Please ensure you upload the unmodified 'orders_export.csv' or 'payment_transactions_export.csv' from Shopify.", "danger");
                    e.target.value = "";
                }
            }
        });
    }

    async parseOrdersExport(data) {
        this.transactions = [];
        this.paymentMethods.clear();
        
        // Group by Order ID for Subtotal Validation
        const ordersGroup = {};
        let validationErrors = 0;

        data.forEach(row => {
            const orderId = row['Name'];
            if (!orderId) return;
            
            if (!ordersGroup[orderId]) {
                ordersGroup[orderId] = {
                    lines: [],
                    subtotal: this.parseAmt(row['Subtotal']),
                    paymentMethod: row['Payment Method'] || 'Shopify Payments',
                    shipping: this.parseAmt(row['Shipping']),
                    taxes: this.parseAmt(row['Taxes']),
                    discount: this.parseAmt(row['Discount Amount']),
                    paidAt: row['Paid at']
                };
            }
            ordersGroup[orderId].lines.push(row);
        });

        for (const [orderId, order] of Object.entries(ordersGroup)) {
            let calculatedLineTotal = 0;
            this.paymentMethods.add(order.paymentMethod);

            order.lines.forEach(row => {
                const qty = this.parseAmt(row['Lineitem quantity']);
                const price = this.parseAmt(row['Lineitem price']);
                calculatedLineTotal += (qty * price);

                // Standardize the mapping LineItem string
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
                    settlementId: '', // Blank for orders
                    orderId: orderId,
                    mainTabGrouping: order.paymentMethod,
                    category: (this.categoriesDict[lineItemKey] || {}).category || "",
                    shipping: order.shipping,
                    taxes: order.taxes,
                    discount: order.discount,
                    selected: false
                });
            });

            // Subtotal Validation
            if (Math.abs(calculatedLineTotal - order.subtotal) > 0.05) {
                validationErrors++;
                console.warn(`Mismatch on ${orderId}: Lines = ${calculatedLineTotal}, Subtotal = ${order.subtotal}`);
            }
        }

        if (validationErrors > 0) {
            this.showAlert(`<strong>Validation Warning:</strong> ${validationErrors} orders have line items that do not equal the stated Subtotal. Proceed with caution.`, "danger");
        }

        this.renderDynamicTabs();
        this.renderActiveView();
        document.getElementById('syncQboBtn').disabled = false;
    }

    async parsePayoutsExport(data) {
        this.transactions = [];
        this.paymentMethods.clear();
        this.showAlert("<strong>Under Construction:</strong> The payout parser logic is staging. Displaying raw payout data.", "info");

        // Logic to group by Payout ID and determine net Deposits/Expenses will go here

        this.renderDynamicTabs();
        this.renderActiveView();
    }

    renderTable() {
        const currentData = this.getFilteredData();
        let html = `
            <div style="margin-bottom: 10px; display:flex; justify-content:space-between; align-items:center;">
                <span style="font-size:0.9rem; color:#666;">Showing ${currentData.length} rows</span>
            </div>
            <div class="table-responsive">
            <table><thead><tr>
                <th style="width: 40px;"><input type="checkbox"></th>
                <th>Type</th>
                <th>Line Item</th>
                <th>Category</th>
                <th>Description</th>
                <th>SKU</th>
                <th style="text-align: right;">Qty</th>
                <th style="text-align: right;">Rate</th>
                <th style="text-align: right;">Total</th>
                <th>Date Paid</th>
                <th>Order ID</th>
            </tr></thead><tbody>
        `;

        if (currentData.length === 0) {
            html += `<tr><td colspan="11" style="text-align:center;">No data.</td></tr>`;
        }

        currentData.forEach((t) => {
            let catDisplay = t.category || `<input type="text" class="cat-input" placeholder="Add Category..."><span class="text-danger"> Missing</span>`;
            
            html += `<tr>
                <td><input type="checkbox" class="row-checkbox" ${t.selected ? 'checked' : ''}></td>
                <td>${t.transactionType}</td>
                <td><strong>${t.lineItem}</strong></td>
                <td>${catDisplay}</td>
                <td><span style="font-size: 0.8rem;">${t.description}</span></td>
                <td>${t.sku || ''}</td>
                <td style="text-align: right;">${t.quantity}</td>
                <td style="text-align: right;">${t.rate.toFixed(2)}</td>
                <td style="text-align: right; font-weight: bold;">${t.totalAmount.toFixed(2)}</td>
                <td>${this.formatDateStr(t.dateTime)}</td>
                <td>${t.orderId}</td>
            </tr>`;
        });

        html += `</tbody></table></div>`;
        document.getElementById('tabContent').innerHTML = html;
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
            <div class="table-responsive">
            <table><thead><tr>
                <th>Line Item</th>
                <th>Category Name (QBO Account)</th>
                <th>Account Type</th>
                <th>Description</th>
            </tr></thead><tbody>
        `;

        if (unmappedData.length === 0) {
            html += `<tr><td colspan="4" style="text-align:center; padding: 2rem; color: #27ae60; font-weight: bold;">All line items are successfully mapped!</td></tr>`;
        }

        unmappedData.forEach((t, i) => {
            html += `<tr>
                <td><strong>${t.lineItem}</strong></td>
                <td><input type="text" placeholder="E.g., Shopify Sales"></td>
                <td>
                    <select>
                        <option value="Income">Income</option>
                        <option value="Expense">Expense</option>
                    </select>
                </td>
                <td><input type="text" placeholder="Optional desc"></td>
            </tr>`;
        });

        html += `</tbody></table></div>`;
        document.getElementById('tabContent').innerHTML = html;
    }

    async handlePushToQbo() {
        this.showAlert("Push handlers pending linking to QBO backend logic.", "info");
    }
}
