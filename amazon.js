// amazon.js
import { db, functions } from './auth.js'; 
import { collection, doc, getDoc, setDoc, getDocs, writeBatch } from "https://www.gstatic.com/firebasejs/12.11.0/firebase-firestore.js";
import { httpsCallable } from "https://www.gstatic.com/firebasejs/12.11.0/firebase-functions.js";
import { getStorage, ref, uploadBytes } from "https://www.gstatic.com/firebasejs/12.11.0/firebase-storage.js";
import { currentUser } from './app.js';

import { pushSalesReceipts } from './transHandlers/salesReceipt.js';
import { pushRefundReceipts } from './transHandlers/refundReceipt.js';
import { pushDeposits } from './transHandlers/deposit.js';
import { pushExpenses } from './transHandlers/expense.js';
import { pushPayouts } from './transHandlers/payout.js';

export default class Amazon {
    constructor() {
        this.transactions = [];
        this.categoriesDict = {};
        
        // Live QBO Data
        this.qboAccounts = [];
        this.qboItems = [];
        
        this.depositAccount = "Payments to Deposit"; 
        this.startDate = "";
        this.endDate = "";
        this.activeMainTab = "all";
        this.activeSubTab = "table";
        
        // Role State
        this.userRole = 'guest'; 
        this.userProfile = null;
    }

    parseAmt(val) {
        if (val === undefined || val === null) return 0;
        return parseFloat(String(val).replace(/,/g, '')) || 0;
    }

    getAmazonDateStr(dateStr) {
        if (!dateStr) return new Date().toISOString().split('T')[0];
        const d = new Date(dateStr);
        if (isNaN(d.getTime())) return new Date().toISOString().split('T')[0];
        
        const formatter = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit' });
        const parts = formatter.formatToParts(d);
        return `${parts.find(p => p.type === 'year').value}-${parts.find(p => p.type === 'month').value}-${parts.find(p => p.type === 'day').value}`;
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
                <h2 style="margin-top: 0; margin-bottom: 0.25rem; font-size: 1.4rem;">VillSync to QBO: Amazon Integrator</h2>
                <p style="color: #666; font-size: 0.85rem; margin-top: 0;">Upload your <strong>AMAZON_DATE_RANGE_REPORT.csv</strong> exactly as downloaded, without any edits.</p>
                <div id="alertBox" class="alert" style="margin-bottom: 0.25rem; padding: 0.4rem;"></div>

                <div id="pushStatusBar" class="desktop-scroll-row" style="background: #f8f9fa; border: 1px solid #dee2e6; border-left: 4px solid #3498db; padding: 0.4rem 1rem; margin-bottom: 0.25rem; border-radius: 4px; justify-content: space-between; align-items: center; font-size: 0.9rem; position: relative; overflow-y: hidden;">
                    <div id="pushProgressFill" style="position: absolute; left: 0; top: 0; bottom: 0; width: 0%; background: #27ae60; z-index: 0; transition: width 0.3s ease;"></div>
                    <span id="pushStatusText" style="font-weight: 500; color: #2c3e50; z-index: 1; position: relative; transition: color 0.3s ease; margin-right: 15px;">Loading user profile...</span>
                    <span id="limitText" style="color: #666; z-index: 1; position: relative; margin-left: auto;"></span>
                </div>

                <div id="highVolumeBanner" style="display: none; animation: flashWarning 1.5s infinite; color: #856404; border: 1px solid #ffeeba; padding: 0.4rem; margin-bottom: 0.5rem; border-radius: 4px; text-align: center; font-size: 0.85rem; font-weight: bold;">
                    ⚠️ For a better experience, please reduce the number of transactions to push per batch to 500 or less by applying a date filter!
                </div>

                <div id="controlPanel" class="control-panel desktop-scroll-row" style="gap: 10px; align-items: center; margin-bottom: 1rem; padding: 0.75rem;">
                    <input type="file" id="csvFile" accept=".csv, .tsv" style="min-width: 200px;">
                    
                    <div style="display: flex; gap: 5px; align-items: center;">
                        <label style="font-size: 0.8rem; font-weight: bold;">Filter Dates:</label>
                        <input type="date" id="startDate" title="Start Date">
                        <span>to</span>
                        <input type="date" id="endDate" title="End Date">
                    </div>

                    <input type="text" id="depositAccount" value="Payments to Deposit" placeholder="Offset Account" style="width: 200px;">
                    <button id="syncQboBtn" class="btn" disabled>Push Current View</button>
                    <button id="viewHistoryBtn" class="btn outline" style="background: white; color: #2c3e50; border: 1px solid #2c3e50;">View Batch History</button>
                </div>

                <div class="tabs main-tabs desktop-scroll-row" style="border-bottom: 2px solid #3498db; margin-bottom: 0; gap: 0;">
                    <button class="tab active" data-maintab="all">All Data</button>
                    <button class="tab" data-maintab="sales">Sales Receipts</button>
                    <button class="tab" data-maintab="refunds">Refunds</button>
                    <button class="tab" data-maintab="expenses">Expenses</button>
                    <button class="tab" data-maintab="deposits">Deposits</button>
                    <button class="tab" data-maintab="payouts">Payouts</button>
                    <button class="tab" data-maintab="unmapped" style="color: var(--danger);">Mapping</button>
                </div>

                <div class="tabs sub-tabs desktop-scroll-row" style="background: #f8f9fa; padding-top: 5px; margin-bottom: 1rem;" id="subTabContainer">
                    <button class="tab active" data-subtab="table" style="font-size: 0.9rem; padding: 0.5rem 1rem;">Data Table View</button>
                    <button class="tab" data-subtab="journal" style="font-size: 0.9rem; padding: 0.5rem 1rem;">Summary Journal View</button>
                </div>

                <div id="tabContent">
                    <p style="padding: 2rem; text-align: center; color: #7f8c8d;">Select a QBO Account and upload an Amazon Date Range Report to begin.</p>
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

        document.querySelectorAll('.main-tabs .tab').forEach(tab => {
            tab.addEventListener('click', (e) => {
                document.querySelectorAll('.main-tabs .tab').forEach(t => t.classList.remove('active'));
                e.target.classList.add('active');
                this.activeMainTab = e.target.dataset.maintab;
                
                const ctrlPanel = document.getElementById('controlPanel');
                const subTabs = document.getElementById('subTabContainer');
                const statusBar = document.getElementById('pushStatusBar');
                
                if (this.activeMainTab === 'unmapped') {
                    ctrlPanel.style.display = 'flex';
                    subTabs.style.display = 'none';
                    statusBar.style.display = 'flex';
                } else {
                    ctrlPanel.style.display = 'flex';
                    subTabs.style.display = 'flex';
                    statusBar.style.display = 'flex';
                }
                this.renderActiveView();
            });
        });

        document.querySelectorAll('.sub-tabs .tab').forEach(tab => {
            tab.addEventListener('click', (e) => {
                document.querySelectorAll('.sub-tabs .tab').forEach(t => t.classList.remove('active'));
                e.target.classList.add('active');
                this.activeSubTab = e.target.dataset.subtab;
                this.renderActiveView();
            });
        });

        window.deleteBatch = (batchId, realmId) => this.handleDeleteBatch(batchId, realmId);
    }

    async checkUserRoleAndLimits() {
        if (!currentUser) {
            document.getElementById('tabContent').innerHTML = `<p style="padding: 2rem; text-align: center; color: #7f8c8d;">Please log in to continue.</p>`;
            return;
        }

        this.userRole = 'guest'; 
        
        // 1. Check for Master Super Admin
        if (currentUser.email === 'vnvcpas.excelimporter@gmail.com') {
            this.userRole = 'super_admin';
        } else {
            // 2. Check for Tool-Specific Admin
            try {
                const adminDoc = await getDoc(doc(db, "global_config", "admins"));
                if (adminDoc.exists()) {
                    const adminData = adminDoc.data()[currentUser.email];
                    // Verify the user is an admin AND they have 'amazon' in their tools array
                    if (adminData && typeof adminData === 'object' && adminData.tools && adminData.tools.includes('amazon')) {
                        this.userRole = 'admin';
                    }
                }
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
            if (this.userProfile.role !== this.userRole) {
                this.userProfile.role = this.userRole;
                this.userProfile.monthlyLimit = this.userRole === 'guest' ? 10 : Infinity;
                await setDoc(profileRef, { role: this.userRole, monthlyLimit: this.userProfile.monthlyLimit }, { merge: true });
            }
        }
        
        document.getElementById('tabContent').innerHTML = `<p style="padding: 2rem; text-align: center; color: #7f8c8d;">Select a QBO Account and upload an Amazon Date Range Report to begin.</p>`;
        this.updateReadyStatus();
    }

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

    async loadCategories() {
        this.categoriesDict = {};
        try {
            const defaultSnap = await getDocs(collection(db, "category"));
            defaultSnap.forEach(doc => { 
                this.categoriesDict[doc.id] = { category: doc.data().category, accountType: doc.data().accountType || "", source: 'default' }; 
            });
        } catch (e) {}

        const qboSelect = document.getElementById('qboSelect');
        if (qboSelect && qboSelect.value && currentUser) {
            try {
                const companySnap = await getDocs(collection(db, `qbo_companies/${qboSelect.value}/category_mappings`));
                companySnap.forEach(doc => {
                    this.categoriesDict[doc.id] = { category: doc.data().category, accountType: doc.data().accountType || "", source: 'company' };
                });
            } catch (e) {}
        }
    }

    renderActiveView() {
        if (this.transactions.length === 0) return;
        this.updateReadyStatus();

        if (this.activeMainTab === 'unmapped') return this.renderMappingTable();
        if (this.activeSubTab === 'table') return this.renderTable();
        this.renderJournal();
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
            statusText.innerText = `${linesPushed} lines for ${txnsPushed} ${typeName} transactions pushed out of ${totalLines}.`;
            statusText.style.color = "#ffffff"; 
            statusText.style.textShadow = "1px 1px 3px rgba(0,0,0,0.6)"; 
        }
        
        if (progressFill && totalTxns > 0) {
            const percentage = Math.min(100, Math.round((txnsPushed / totalTxns) * 100));
            progressFill.style.width = `${percentage}%`;
        }
    }

    getFilteredAndPartitionedData() {
        let data = this.transactions;

        if (this.startDate || this.endDate) {
            data = data.filter(t => {
                if (!t['date/time']) return true; 
                const amazonDate = this.getAmazonDateStr(t['date/time']); 
                if (this.startDate && amazonDate < this.startDate) return false;
                if (this.endDate && amazonDate > this.endDate) return false;
                return true;
            });
        }

        if (this.activeMainTab === 'sales') {
            data = data.filter(t => t.type.toLowerCase() === 'order' && t.groupClass === 'receipt');
        } else if (this.activeMainTab === 'refunds') {
            data = data.filter(t => t.type.toLowerCase() === 'refund' && t.groupClass === 'receipt');
        } else if (this.activeMainTab === 'expenses') {
            data = data.filter(t => {
                const isOrderFee = (t.type.toLowerCase() === 'order' && t.groupClass === 'fee');
                const isGeneralExpense = (t.type.toLowerCase() !== 'order' && t.type.toLowerCase() !== 'refund' && t.type.toLowerCase() !== 'transfer' && this.parseAmt(t.total) < 0);
                return isOrderFee || isGeneralExpense;
            });
        } else if (this.activeMainTab === 'deposits') {
            data = data.filter(t => {
                const isRefundFee = (t.type.toLowerCase() === 'refund' && t.groupClass === 'fee');
                const isGeneralDeposit = (t.type.toLowerCase() !== 'order' && t.type.toLowerCase() !== 'refund' && t.type.toLowerCase() !== 'transfer' && this.parseAmt(t.total) >= 0);
                return isRefundFee || isGeneralDeposit;
            });
        } else if (this.activeMainTab === 'payouts') {
            data = data.filter(t => t.type.toLowerCase() === 'transfer');
        }
        return data;
    }

    showAlert(message, type = "warning") {
        const box = document.getElementById('alertBox');
        box.innerHTML = message;
        box.className = `alert alert-${type} visible`;
    }

    hideAlert() {
        document.getElementById('alertBox').className = "alert";
    }

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

        this.parseFileAndLogRecord(file, realmId);
    }

    parseFileAndLogRecord(file, realmId) {
        Papa.parse(file, {
            header: true,
            skipEmptyLines: true,
            complete: async (results) => {
                await this.logFileRecord(file, realmId);
                await this.parseData(results.data);
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

    async parseData(data) {
        const isGuest = !this.userProfile || this.userProfile.role === 'guest';
        if (isGuest && data.length > 10) {
            data = data.slice(0, 10);
            this.showAlert("Guest Mode: File truncated to first 10 transaction lines. Please upgrade via Subscriptions for unlimited processing.", "info");
        }

        const expandedTransactions = [];
        const receiptColumns = [
            'product sales', 'product sales tax', 'shipping credits', 'shipping credits tax',
            'gift wrap credits', 'giftwrap credits tax', 'Regulatory Fee', 'Tax On Regulatory Fee'
        ];
        const feeColumns = [
            'promotional rebates', 'promotional rebates tax', 'marketplace withheld tax',
            'selling fees', 'fba fees'
        ];

        data.forEach(row => {
            const typeStr = (row['type'] || "").trim();
            const tLower = typeStr.toLowerCase();

            if (tLower === 'order' || tLower === 'refund') {
                const prefix = typeStr; 

                receiptColumns.forEach(colName => {
                    const amt = this.parseAmt(row[colName]);
                    if (amt !== 0) {
                        const lineItemName = `${prefix} ${colName}`;
                        expandedTransactions.push({
                            ...row, type: typeStr, total: amt, quantity: row['quantity'] || 1, description: row['description'] || "",
                            lineItem: lineItemName, category: (this.categoriesDict[lineItemName] || {}).category || "",
                            uid: Date.now().toString(36) + Math.random().toString(36).substring(2), selected: false, groupClass: 'receipt'
                        });
                    }
                });

                feeColumns.forEach(colName => {
                    const amt = this.parseAmt(row[colName]);
                    if (amt !== 0) {
                        const lineItemName = `${prefix} ${colName}`;
                        expandedTransactions.push({
                            ...row, type: typeStr, total: amt, quantity: row['quantity'] || 1, description: row['description'] || "",
                            lineItem: lineItemName, category: (this.categoriesDict[lineItemName] || {}).category || "",
                            uid: Date.now().toString(36) + Math.random().toString(36).substring(2), selected: false, groupClass: 'fee'
                        });
                    }
                });

            } else {
                let lineItem = `${typeStr} - ${row['description'] || ""}`.replace(/^ - | - $/g, '').trim();
                if (tLower === 'transfer') {
                    const commaIndex = lineItem.indexOf(',');
                    if (commaIndex !== -1) lineItem = lineItem.substring(0, commaIndex).trim();
                }

                const amt = this.parseAmt(row['total']);
                if (amt !== 0 || typeStr !== "") {
                    expandedTransactions.push({
                        ...row, type: typeStr, total: amt, quantity: 1, description: row['description'] || "",
                        lineItem: lineItem, category: (this.categoriesDict[lineItem] || {}).category || "",
                        uid: Date.now().toString(36) + Math.random().toString(36).substring(2), selected: false, groupClass: 'general'
                    });
                }
            }
        });

        this.transactions = expandedTransactions;
        document.getElementById('syncQboBtn').disabled = false;
        
        await this.checkForDuplicates();
        this.renderActiveView();
    }

    async checkForDuplicates() {
        const qboSelect = document.getElementById('qboSelect');
        if (!currentUser || !qboSelect || !qboSelect.value) return;
        const realmId = qboSelect.value;
        
        try {
            const ledgerSnap = await getDocs(collection(db, `qbo_companies/${realmId}/qbo_sync_ledger`));
            const existingSigs = new Set();
            ledgerSnap.forEach(d => existingSigs.add(d.id));

            let duplicateCount = 0;
            const groups = { sales: {}, refunds: {}, expenses: {}, deposits: {}, payouts: {} };

            this.transactions.forEach(t => {
                const oId = t['order id'] || t.uid;
                const dateStamp = t['date/time'] || 'nodate';
                const settlementId = t['settlement id'] || 'nosettlement';
                const groupKey = `${oId}_${dateStamp}_${settlementId}`;
                const typeLower = (t.type || "").toLowerCase();
                const amt = this.parseAmt(t.total);

                let mainTab = null;
                if (typeLower === 'order' && t.groupClass === 'receipt') mainTab = 'sales';
                else if (typeLower === 'refund' && t.groupClass === 'receipt') mainTab = 'refunds';
                else if ((typeLower === 'order' && t.groupClass === 'fee') || (typeLower !== 'order' && typeLower !== 'refund' && typeLower !== 'transfer' && amt < 0)) mainTab = 'expenses';
                else if ((typeLower === 'refund' && t.groupClass === 'fee') || (typeLower !== 'order' && typeLower !== 'refund' && typeLower !== 'transfer' && amt >= 0)) mainTab = 'deposits';
                else if (typeLower === 'transfer') mainTab = 'payouts';

                if (mainTab) {
                    if (!groups[mainTab][groupKey]) groups[mainTab][groupKey] = { date: t['date/time'], settlementId: t['settlement id'], lines: [] };
                    groups[mainTab][groupKey].lines.push(t);
                }
            });

            for (const [tab, tabGroups] of Object.entries(groups)) {
                if (tab === 'payouts') {
                    for (const groupData of Object.values(tabGroups)) {
                        groupData.lines.forEach(t => {
                            const exactTimeMs = t['date/time'] ? new Date(t['date/time']).getTime() : Date.now();
                            const amt = Math.abs(this.parseAmt(t.total));
                            const signature = `PAYOUT_${exactTimeMs}_${t['settlement id']}_${amt.toFixed(2)}`;
                            if (existingSigs.has(signature)) {
                                t.selected = true;
                                duplicateCount++;
                            }
                        });
                    }
                } else {
                    for (const groupData of Object.values(tabGroups)) {
                        const exactTimeMs = groupData.date ? new Date(groupData.date).getTime() : Date.now();
                        let netAmount = 0;
                        groupData.lines.forEach(l => netAmount += Math.abs(this.parseAmt(l.total)));

                        let prefix = { 'sales': "SALES", 'refunds': "REFUND", 'expenses': "EXP", 'deposits': "DEP" }[tab];
                        const signature = `${prefix}_${exactTimeMs}_${groupData.settlementId}_${netAmount.toFixed(2)}`;

                        if (existingSigs.has(signature)) {
                            groupData.lines.forEach(l => {
                                l.selected = true;
                                duplicateCount++;
                            });
                        }
                    }
                }
            }

            if (duplicateCount > 0) {
                this.showAlert(`<strong>Heads up!</strong> ${duplicateCount} duplicate transactions found and automatically checked. Please review them. Only unchecked transactions will be pushed to QBO.`, "warning");
            }

        } catch (error) {
            console.error("Duplicate check failed:", error);
        }
    }

    renderTable() {
        const currentData = this.getFilteredAndPartitionedData();
        
        let html = `
            <div style="margin-bottom: 10px; display:flex; justify-content:space-between; align-items:center;">
                <button class="btn danger" onclick="window.deleteSelected()">Delete Selected Rows</button>
                <span style="font-size:0.9rem; color:#d35400; font-weight:bold;">⚠️ Checked rows are ignored and will NOT be pushed to QBO.</span>
                <span style="font-size:0.9rem; color:#666;">Showing ${currentData.length} rows</span>
            </div>
            <div class="table-responsive">
            <table><thead><tr>
                <th style="width: 40px;"><input type="checkbox" id="selectAllCb" onchange="window.toggleSelectAll(this.checked)"></th>
                <th>Transaction Type</th>
                <th>Line Item</th>
                <th>Category</th>
                <th>Description</th>
                <th>SKU</th>
                <th style="text-align: right;">Qty</th>
                <th style="text-align: right;">Amount</th>
                <th>Date/Time</th>
                <th>Settlement ID</th>
                <th>Order ID</th>
            </tr></thead><tbody>
        `;

        if (currentData.length === 0) {
            html += `<tr><td colspan="11" style="text-align:center;">No data matches the current filters.</td></tr>`;
        }

        currentData.forEach((t) => {
            let catDisplay = t.category;
            const liveMatch = this.qboAccounts.find(a => a.name.toLowerCase() === t.lineItem.toLowerCase());
            if (liveMatch && !t.category) {
                catDisplay = liveMatch.name;
                t.category = liveMatch.name;
            } else if (!t.category) {
                catDisplay = `<span class="text-danger">Missing</span>`;
            }

            html += `<tr>
                <td><input type="checkbox" class="row-checkbox" data-uid="${t.uid}" ${t.selected ? 'checked' : ''} onchange="window.toggleRow('${t.uid}', this.checked)"></td>
                <td>${t['type'] || ''}</td>
                <td><strong>${t.lineItem}</strong></td>
                <td>${catDisplay}</td>
                <td><span style="font-size: 0.8rem; color: #555;">${t.description || ''}</span></td>
                <td>${t['sku'] || ''}</td>
                <td style="text-align: right;">${t.quantity || 1}</td>
                <td style="text-align: right; font-weight: bold;">${parseFloat(t.total || 0).toFixed(2)}</td>
                <td>${t['date/time'] || ''}</td>
                <td>${t['settlement id'] || ''}</td>
                <td>${t['order id'] || ''}</td>
            </tr>`;
        });

        html += `</tbody></table></div>`;
        document.getElementById('tabContent').innerHTML = html;

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

            let typeDropdownHtml = `<select id="unmap-type-${i}" style="padding:0.4rem; width:100%; box-sizing: border-box;" ${accInQbo ? 'disabled' : ''}>`;
            const lowerLine = lineItem.toLowerCase();
            let defaultType = (lowerLine.includes('sales') || lowerLine.includes('shipping') || lowerLine.includes('credits')) ? 'Income' : 'Expense';
            fullAccountTypes.forEach(t => {
                const selected = accMatch && accMatch.type === t ? 'selected' : (t === defaultType ? 'selected' : '');
                typeDropdownHtml += `<option value="${t}" ${selected}>${t}</option>`;
            });
            typeDropdownHtml += `</select>`;

            let defaultItemType = (lowerLine.includes('fee') || lowerLine.includes('tax')) ? 'Service' : 'NonInventory';
            if (itemMatch) defaultItemType = itemMatch.type;
            
            let statusHtml = '';
            if (itemInQbo) statusHtml += `<div class="qbo-badge">✅ Item in QBO</div>`;
            if (accInQbo) statusHtml += `<div class="qbo-badge" style="margin-top:3px;">✅ Account in QBO</div>`;
            if (!itemInQbo && !accInQbo) statusHtml = `<span style="color:#e74c3c; font-size:0.8rem;">Unmapped</span>`;

            // Removed isGuest from the disabled check!
            const isDisabled = isFullyMapped;

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
                    <button class="btn" style="background:${isDisabled ? '#95a5a6' : '#27ae60'}; color:white; font-weight:bold; padding:0.4rem 0.8rem; border-radius:3px; border:none; cursor:${isDisabled ? 'not-allowed' : 'pointer'};" onclick="window.pushToQboMapping('${lineItem}', ${i})" ${isDisabled ? 'disabled' : ''} title="Save mapping to QBO">Save to QBO</button>
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
                btn.disabled = false;
            }
        };
    }

    async handlePushToQbo() {
        if (this.userRole === 'guest' && this.userProfile.monthlyBatchesPushed >= 10) {
            return this.showAlert("Monthly push limit reached (10/10). Please subscribe in the UI to continue pushing data.", "danger");
        }

        if (this.activeMainTab === 'all') return this.showAlert("Please select a specific transaction tab (Sales, Refunds, etc.) to push.", "warning");
        const qboSelect = document.getElementById('qboSelect');
        if (!qboSelect || !qboSelect.value) return this.showAlert("Please connect and select a QBO account first.", "warning");

        const visibleData = this.getFilteredAndPartitionedData().filter(t => !t.selected);
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
                depositAccountName: this.depositAccount && this.depositAccount.trim() !== "" ? this.depositAccount : "Payments to Deposit",
                functions: functions,
                endDate: this.endDate,
                batchId: `batch_${Date.now()}` 
            };

            let pushedIds = [];

            if (this.activeSubTab === 'table') {
                if (this.activeMainTab === 'sales') pushedIds = await pushSalesReceipts(visibleData, config, this);
                else if (this.activeMainTab === 'refunds') pushedIds = await pushRefundReceipts(visibleData, config, this);
                else if (this.activeMainTab === 'deposits') pushedIds = await pushDeposits(visibleData, config, this);
                else if (this.activeMainTab === 'expenses') pushedIds = await pushExpenses(visibleData, config, this);
                else if (this.activeMainTab === 'payouts') pushedIds = await pushPayouts(visibleData, config, this);
            } else {
                pushedIds = await this.pushStandardJournalEntry(visibleData, config);
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

    async pushStandardJournalEntry(visibleData, config) {
        const getOrCreateQboAccount = httpsCallable(config.functions, 'getOrCreateQboAccount');
        const pushJournalEntry = httpsCallable(config.functions, 'pushJournalEntry');

        let depId;
        const depResponse = await getOrCreateQboAccount({ accountName: config.depositAccountName, realmId: config.realmId, accountType: "Bank" });
        depId = depResponse.data.id;

        let pushedIds = [];

        if (this.activeMainTab === 'payouts') {
            const totalTxns = visibleData.length;
            const totalLines = visibleData.length;
            let txnsPushed = 0;
            let linesPushed = 0;

            for (const t of visibleData) {
                if (!t.category) throw new Error("Missing Categories: Please map all payout line items.");
                const amt = this.parseAmt(t.total);
                if (amt === 0) continue;

                const catResponse = await getOrCreateQboAccount({ accountName: t.category, realmId: config.realmId });
                const qboId = catResponse.data.id;

                const individualLines = [];
                if (amt < 0) {
                    individualLines.push({ postingType: "Debit", amount: Math.abs(amt), qboAccountId: qboId, description: t.lineItem });
                    individualLines.push({ postingType: "Credit", amount: Math.abs(amt), qboAccountId: depId, description: "Payout Transfer Offset" });
                } else {
                    individualLines.push({ postingType: "Credit", amount: amt, qboAccountId: qboId, description: t.lineItem });
                    individualLines.push({ postingType: "Debit", amount: amt, qboAccountId: depId, description: "Payout Transfer Offset" });
                }

                const tDate = t['date/time'] ? this.getAmazonDateStr(t['date/time']) : null;
                const res = await pushJournalEntry({ realmId: config.realmId, lines: individualLines, txnDate: tDate, privateNote: `VilBooks Transfer ID: ${t['settlement id'] || 'Manual'}` });
                pushedIds.push({ type: "JournalEntry", id: res.data.qboResponseId });
                
                const exactTimeMs = t['date/time'] ? new Date(t['date/time']).getTime() : Date.now();
                const signature = `PAYOUT_${exactTimeMs}_${t['settlement id']}_${Math.abs(amt).toFixed(2)}`;
                await setDoc(doc(db, `qbo_companies/${config.realmId}/qbo_sync_ledger`, signature), { batchId: config.batchId, qboId: res.data.qboResponseId, timestamp: new Date().toISOString() });
                
                txnsPushed++;
                linesPushed++;
                this.updatePushProgress(linesPushed, txnsPushed, totalLines, totalTxns, 'payout');
            }
            this.showAlert(`Success! ${visibleData.length} Individual Payout Entries created in QBO.`, "success");
        } else {
            let summary = {};
            let netDeposit = 0;
            let missingCats = false;

            visibleData.forEach(t => {
                if (!t.category) missingCats = true;
                const amt = this.parseAmt(t.total);
                const key = t.lineItem || "UNCATEGORIZED"; 
                if (!summary[key]) summary[key] = { amt: 0, catName: t.category };
                summary[key].amt += amt;
                netDeposit += amt;
            });

            if (missingCats) throw new Error("Missing Categories: Please map all line items before pushing.");

            const linesToPush = [];
            if (netDeposit > 0) {
                linesToPush.push({ postingType: "Debit", amount: netDeposit, qboAccountId: depId, description: `Total ${this.activeMainTab}` });
            } else if (netDeposit < 0) {
                linesToPush.push({ postingType: "Credit", amount: Math.abs(netDeposit), qboAccountId: depId, description: `Total ${this.activeMainTab}` });
            }

            for (const lineKey of Object.keys(summary)) {
                const amt = summary[lineKey].amt;
                if (amt === 0) continue;

                const catResponse = await getOrCreateQboAccount({ accountName: summary[lineKey].catName, realmId: config.realmId });
                if (amt < 0) linesToPush.push({ postingType: "Debit", amount: Math.abs(amt), qboAccountId: catResponse.data.id, description: lineKey });
                else linesToPush.push({ postingType: "Credit", amount: amt, qboAccountId: catResponse.data.id, description: lineKey });
            }

            let summaryDateStr = config.endDate;
            if (!summaryDateStr) {
                const dates = visibleData.map(t => new Date(t['date/time']).getTime()).filter(n => !isNaN(n));
                if (dates.length > 0) summaryDateStr = this.getAmazonDateStr(new Date(Math.max(...dates)).toISOString());
            }

            const response = await pushJournalEntry({ realmId: config.realmId, lines: linesToPush, txnDate: summaryDateStr, privateNote: `Imported via VilBooks - Tab: ${this.activeMainTab.toUpperCase()}` });
            if (response.data.success) {
                this.showAlert(`Success! ${this.activeMainTab.toUpperCase()} Summary Journal Entry created in QBO.`, "success");
                pushedIds.push({ type: "JournalEntry", id: response.data.qboResponseId });
                this.updatePushProgress(visibleData.length, 1, visibleData.length, 1, 'journal entry');
                
                const groups = {};
                visibleData.forEach(t => {
                    const oId = t['order id'] || t.uid;
                    const dateStamp = t['date/time'] || 'nodate';
                    const settlementId = t['settlement id'] || 'nosettlement';
                    const groupKey = `${oId}_${dateStamp}_${settlementId}`;
                    if (!groups[groupKey]) groups[groupKey] = { date: t['date/time'], settlementId: t['settlement id'], lines: [] };
                    groups[groupKey].lines.push(t);
                });
                
                for (const groupData of Object.values(groups)) {
                    const exactTimeMs = groupData.date ? new Date(groupData.date).getTime() : Date.now();
                    let grpAmt = 0;
                    groupData.lines.forEach(l => grpAmt += Math.abs(this.parseAmt(l.total)));
                    let prefix = { 'sales': "SALES", 'refunds': "REFUND", 'expenses': "EXP", 'deposits': "DEP" }[this.activeMainTab] || "JRNL";
                    const signature = `${prefix}_${exactTimeMs}_${groupData.settlementId}_${grpAmt.toFixed(2)}`;
                    await setDoc(doc(db, `qbo_companies/${config.realmId}/qbo_sync_ledger`, signature), { batchId: config.batchId, qboId: response.data.qboResponseId, timestamp: new Date().toISOString() });
                }
            }
        }
        return pushedIds;
    }

    renderJournal() {
        const currentData = this.getFilteredAndPartitionedData();

        if (currentData.length === 0) {
            let html = `
                <div class="table-responsive">
                <table><thead><tr>
                    <th>Account / Category</th>
                    <th style="text-align: right;">Debit</th>
                    <th style="text-align: right;">Credit</th>
                    <th>Line Description</th>
                </tr></thead><tbody>
                <tr><td colspan="4" style="text-align:center;">No data matches the current filters.</td></tr>
                </tbody></table></div>`;
            document.getElementById('tabContent').innerHTML = html;
            return;
        }

        const depName = this.depositAccount && this.depositAccount.trim() !== "" ? this.depositAccount : "Payments to Deposit";
        let html = `<div class="table-responsive">`;

        if (this.activeMainTab === 'payouts') {
            html += `
                <table><thead><tr>
                    <th>Account / Category</th>
                    <th style="text-align: right;">Debit</th>
                    <th style="text-align: right;">Credit</th>
                    <th>Line Description</th>
                </tr></thead><tbody>
            `;

            currentData.forEach(t => {
                const amt = this.parseAmt(t.total);
                if (amt === 0) return;

                const tDate = t['date/time'] ? this.getAmazonDateStr(t['date/time']) : 'Unknown Date';
                const catRef = t.category || `<span class="text-danger">Missing</span>`;
                const absAmt = Math.abs(amt).toFixed(2);

                html += `<tr style="background:#e9ecef;"><td colspan="4"><strong>Date: ${tDate}</strong> (Settlement ID: ${t['settlement id'] || 'N/A'})</td></tr>`;

                if (amt < 0) {
                    html += `<tr><td>${catRef}</td><td style="text-align: right;">${absAmt}</td><td></td><td>${t.lineItem}</td></tr>`;
                    html += `<tr style="background:#f8f9fa;"><td><strong>${depName}</strong></td><td></td><td style="text-align: right;">${absAmt}</td><td>Payout Transfer Offset</td></tr>`;
                } else {
                    html += `<tr style="background:#f8f9fa;"><td><strong>${depName}</strong></td><td style="text-align: right;">${absAmt}</td><td></td><td>Payout Transfer Offset</td></tr>`;
                    html += `<tr><td>${catRef}</td><td></td><td style="text-align: right;">${absAmt}</td><td>${t.lineItem}</td></tr>`;
                }
            });

            html += `</tbody></table></div>`;
            document.getElementById('tabContent').innerHTML = html;

        } else {
            let summary = {};
            let netDeposit = 0;

            currentData.forEach(t => {
                const amt = this.parseAmt(t.total);
                const key = t.lineItem || "UNCATEGORIZED"; 
                if (!summary[key]) summary[key] = { amt: 0, catName: t.category || `<span class="text-danger">Missing</span>` };
                summary[key].amt += amt;
                netDeposit += amt;
            });

            let summaryDateStr = this.endDate;
            if (!summaryDateStr) {
                const dates = currentData.map(t => new Date(t['date/time']).getTime()).filter(n => !isNaN(n));
                if (dates.length > 0) {
                    summaryDateStr = this.getAmazonDateStr(new Date(Math.max(...dates)).toISOString());
                } else {
                    summaryDateStr = "N/A";
                }
            } else {
                summaryDateStr = this.getAmazonDateStr(this.endDate + "T00:00:00");
            }

            html += `
                <h4 style="margin-top: 0; margin-bottom: 10px; color: #2c3e50;">Journal Entry Date: <span style="font-weight: normal;">${summaryDateStr}</span></h4>
                <table><thead><tr>
                    <th>Account / Category</th>
                    <th style="text-align: right;">Debit</th>
                    <th style="text-align: right;">Credit</th>
                    <th>Line Description</th>
                </tr></thead><tbody>
            `;

            let journalLines = [];
            if (netDeposit > 0) {
                journalLines.push({ catName: `<strong>${depName}</strong>`, debit: netDeposit, credit: 0, desc: `Total ${this.activeMainTab}`, isDeposit: true });
            } else if (netDeposit < 0) {
                journalLines.push({ catName: `<strong>${depName}</strong>`, debit: 0, credit: Math.abs(netDeposit), desc: `Total ${this.activeMainTab}`, isDeposit: true });
            }

            let totalDebit = netDeposit > 0 ? netDeposit : 0;
            let totalCredit = netDeposit < 0 ? Math.abs(netDeposit) : 0;

            Object.keys(summary).forEach(lineKey => {
                const amt = summary[lineKey].amt;
                if (amt < 0) {
                    journalLines.push({ catName: summary[lineKey].catName, debit: Math.abs(amt), credit: 0, desc: lineKey, isDeposit: false });
                    totalDebit += Math.abs(amt);
                } else if (amt > 0) {
                    journalLines.push({ catName: summary[lineKey].catName, debit: 0, credit: amt, desc: lineKey, isDeposit: false });
                    totalCredit += amt;
                }
            });

            journalLines.sort((a, b) => {
                if (a.isDeposit && a.debit > 0) return -1;
                if (b.isDeposit && b.debit > 0) return 1;
                if (a.isDeposit && a.credit > 0) return 1;
                if (b.isDeposit && b.credit > 0) return -1;
                return a.debit > 0 ? -1 : 1; 
            });

            journalLines.forEach(line => {
                const debitStr = line.debit > 0 ? line.debit.toFixed(2) : "";
                const creditStr = line.credit > 0 ? line.credit.toFixed(2) : "";
                html += `<tr><td>${line.catName}</td><td style="text-align: right;">${debitStr}</td><td style="text-align: right;">${creditStr}</td><td>${line.desc}</td></tr>`;
            });

            html += `<tr style="font-weight:bold; background:#e9ecef">
                <td>TOTAL</td>
                <td style="text-align: right;">${totalDebit.toFixed(2)}</td>
                <td style="text-align: right;">${totalCredit.toFixed(2)}</td>
                <td></td>
            </tr>`;

            html += `</tbody></table></div>`;
            document.getElementById('tabContent').innerHTML = html;
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
