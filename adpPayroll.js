// adpPayroll.js
import { db, functions } from './auth.js'; 
import { collection, doc, getDoc, setDoc, getDocs, writeBatch } from "https://www.gstatic.com/firebasejs/12.11.0/firebase-firestore.js";
import { httpsCallable } from "https://www.gstatic.com/firebasejs/12.11.0/firebase-functions.js";
import { getStorage, ref, uploadBytes } from "https://www.gstatic.com/firebasejs/12.11.0/firebase-storage.js";
import { currentUser } from './app.js';

export default class AdpPayroll {
    constructor() {
        this.transactions = [];
        this.categoriesDict = {};
        
        // Live QBO Data
        this.qboAccounts = [];
        this.qboItems = [];
        this.qboClasses = [];
        
        this.activeMainTab = "all";
        this.activeSubTab = "table";
        
        // Role State
        this.userRole = 'guest'; 
        this.userProfile = null;
    }

    parseAmt(val) {
        if (val === undefined || val === null || val === '') return 0;
        if (typeof val === 'string') val = val.replace(/[$,]/g, '');
        return parseFloat(val) || 0;
    }

    formatDateStr(dateStr) {
        if (!dateStr) return new Date().toISOString().split('T')[0];
        const d = new Date(dateStr);
        if (isNaN(d.getTime())) return new Date().toISOString().split('T')[0];
        
        const formatter = new Intl.DateTimeFormat('en-US', { year: 'numeric', month: '2-digit', day: '2-digit' });
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
                <h2 style="margin-top: 0; margin-bottom: 0.25rem; font-size: 1.4rem;">VillSync to QBO: ADP Payroll Integrator</h2>
                <p style="color: #666; font-size: 0.85rem; margin-top: 0;">Upload your unmodified <strong>Payroll Detail Summary</strong> report from ADP RUN.</p>
                <div id="alertBox" class="alert" style="margin-bottom: 0.25rem; padding: 0.4rem;"></div>

                <div id="pushStatusBar" class="desktop-scroll-row" style="background: #f8f9fa; border: 1px solid #dee2e6; border-left: 4px solid #8e44ad; padding: 0.4rem 1rem; margin-bottom: 0.25rem; border-radius: 4px; justify-content: space-between; align-items: center; font-size: 0.9rem; position: relative; overflow-y: hidden;">
                    <div id="pushProgressFill" style="position: absolute; left: 0; top: 0; bottom: 0; width: 0%; background: #27ae60; z-index: 0; transition: width 0.3s ease;"></div>
                    <span id="pushStatusText" style="font-weight: 500; color: #2c3e50; z-index: 1; position: relative; transition: color 0.3s ease; margin-right: 15px;">Loading user profile...</span>
                    <span id="limitText" style="color: #666; z-index: 1; position: relative; margin-left: auto;"></span>
                </div>

                <div id="controlPanel" class="control-panel desktop-scroll-row" style="gap: 10px; align-items: center; margin-bottom: 1rem; padding: 0.75rem;">
                    <input type="file" id="csvFile" accept=".csv" style="min-width: 200px;">
                    <button id="syncQboBtn" class="btn" style="background: #8e44ad;" disabled>Push Journal Entry</button>
                    <button id="viewHistoryBtn" class="btn outline" style="background: white; color: #2c3e50; border: 1px solid #2c3e50;">View Batch History</button>
                </div>

                <div class="tabs main-tabs desktop-scroll-row" style="border-bottom: 2px solid #8e44ad; margin-bottom: 0; gap: 0;">
                    <button class="tab active" data-maintab="all">All Payroll Data</button>
                    <button class="tab" data-maintab="unmapped" style="color: var(--danger);">Mapping</button>
                </div>

                <div class="tabs sub-tabs desktop-scroll-row" style="background: #f8f9fa; padding-top: 5px; margin-bottom: 1rem;" id="subTabContainer">
                    <button class="tab active" data-subtab="table" style="font-size: 0.9rem; padding: 0.5rem 1rem;">Data Table View</button>
                    <button class="tab" data-subtab="journal" style="font-size: 0.9rem; padding: 0.5rem 1rem;">Summary Journal View</button>
                </div>

                <div id="tabContent">
                    <p style="padding: 2rem; text-align: center; color: #7f8c8d;">Select a QBO Account and upload an ADP Payroll CSV to begin.</p>
                </div>
            </div>

            <div id="historyModal" class="modal-overlay">
                <div class="modal-content" style="max-width: 900px;">
                    <h2 style="margin-top:0;">QBO Push History (Batches)</h2>
                    <p style="color: #666;">View and reverse recent transaction batches pushed to QuickBooks.</p>
                    <div id="historyTableContainer" style="margin: 1rem 0; max-height: 400px; overflow-y: auto;"></div>
                    <div style="text-align: right; margin-top: 1rem;">
                        <button class="btn outline" id="closeHistoryModalBtn" style="color: black; border-color: #ccc;">Close</button>
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
        
        // DEFENSIVE BINDING
        const csvFileBtn = document.getElementById('csvFile');
        if (csvFileBtn) csvFileBtn.addEventListener('change', e => this.handleFileSelect(e));

        const syncQboBtn = document.getElementById('syncQboBtn');
        if (syncQboBtn) syncQboBtn.addEventListener('click', () => this.handlePushToQbo());
        
        const viewHistoryBtn = document.getElementById('viewHistoryBtn');
        if (viewHistoryBtn) {
            viewHistoryBtn.addEventListener('click', () => {
                if (!currentUser) return this.showAlert("You must be logged in to view history.", "warning");
                const modal = document.getElementById('historyModal');
                if (modal) modal.style.display = 'flex';
                this.loadBatchHistory();
            });
        }

        const closeHistoryModalBtn = document.getElementById('closeHistoryModalBtn');
        if (closeHistoryModalBtn) {
            closeHistoryModalBtn.addEventListener('click', () => {
                const modal = document.getElementById('historyModal');
                if (modal) modal.style.display = 'none';
            });
        }

        document.querySelectorAll('.main-tabs .tab').forEach(tab => {
            tab.addEventListener('click', (e) => {
                document.querySelectorAll('.main-tabs .tab').forEach(t => t.classList.remove('active'));
                e.target.classList.add('active');
                this.activeMainTab = e.target.dataset.maintab;
                
                const ctrlPanel = document.getElementById('controlPanel');
                const subTabs = document.getElementById('subTabContainer');
                const statusBar = document.getElementById('pushStatusBar');
                
                if (this.activeMainTab === 'unmapped') {
                    if (ctrlPanel) ctrlPanel.style.display = 'flex';
                    if (subTabs) subTabs.style.display = 'none';
                    if (statusBar) statusBar.style.display = 'flex';
                } else {
                    if (ctrlPanel) ctrlPanel.style.display = 'flex';
                    if (subTabs) subTabs.style.display = 'flex';
                    if (statusBar) statusBar.style.display = 'flex';
                }
                this.renderActiveView();
            });
        });

        document.querySelectorAll('.sub-tabs .tab').forEach(tab => {
            tab.addEventListener('click', (e) => {
                document.querySelectorAll('.sub-tabs .tab').forEach(t => t.classList.remove('active'));
                e.target.classList.add('active');
                this.activeSubTab = e.target.dataset.subtab;
                
                // Update push button text contextually
                const syncBtn = document.getElementById('syncQboBtn');
                if (syncBtn) {
                    syncBtn.innerText = this.activeSubTab === 'table' ? "Push Checks to QBO" : "Push Journal Entry";
                }
                
                this.renderActiveView();
            });
        });

        window.deleteBatch = (batchId, realmId) => this.handleDeleteBatch(batchId, realmId);
    }

    async checkUserRoleAndLimits() {
        if (!currentUser) {
            const tabContent = document.getElementById('tabContent');
            if(tabContent) tabContent.innerHTML = `<p style="padding: 2rem; text-align: center; color: #7f8c8d;">Please log in to continue.</p>`;
            return;
        }

        this.userRole = 'guest'; 
        
        // 1. Check for Master Super Admin
        if (currentUser.email === 'vnvcpas.excelimporter@gmail.com') {
            this.userRole = 'super_admin';
        } else {
            // 2. Check for Strict Tool-Specific Admin
            try {
                const adminDoc = await getDoc(doc(db, "global_config", "admins"));
                if (adminDoc.exists()) {
                    const adminData = adminDoc.data()[currentUser.email];
                    if (adminData && typeof adminData === 'object' && Array.isArray(adminData.tools) && adminData.tools.includes('adpPayroll')) {
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
        
        this.updateReadyStatus();
    }

    async loadLiveQboData() {
        this.qboAccounts = [];
        this.qboItems = [];
        this.qboClasses = [];
        
        const qboSelect = document.getElementById('qboSelect');
        if (!qboSelect || !qboSelect.value || !currentUser) return;

        try {
            const fetchQboLists = httpsCallable(functions, 'fetchQboLists');
            const res = await fetchQboLists({ realmId: qboSelect.value });
            this.qboAccounts = res.data.accounts || [];
            this.qboItems = res.data.items || [];
            this.qboClasses = res.data.classes || [];
        } catch (e) {
            console.error("Failed to load live QBO data", e);
            
            // Check if the error is related to an expired or revoked token
            if (e.message && (e.message.includes('token') || e.message.includes('QBO_FETCH_ERROR'))) {
                this.showAlert("<strong>Connection Revoked:</strong> Your QuickBooks connection has expired or was disconnected. Please click the <strong>Connect to QuickBooks</strong> button again to refresh your access.", "danger");
                
                // Optionally disable the push button to prevent failed API calls
                const pushBtn = document.getElementById('syncQboBtn');
                if (pushBtn) pushBtn.disabled = true;
            } else {
                this.showAlert("Could not sync with QBO. Mappings may be inaccurate.", "warning");
            }
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
        const limitText = document.getElementById('limitText');
        const syncBtn = document.getElementById('syncQboBtn');

        if (!statusText || !limitText) return;
        
        if (this.userRole === 'super_admin' || this.userRole === 'admin') {
            limitText.innerHTML = `<strong>${this.userRole.toUpperCase()}</strong> | Unlimited Pushes`;
            limitText.style.color = "#27ae60";
        } else {
            let remaining = Math.max(0, 10 - (this.userProfile?.monthlyBatchesPushed || 0));
            limitText.innerHTML = `<strong>GUEST</strong> | ${remaining} batches left`;
            limitText.style.color = remaining <= 2 ? "#e74c3c" : "#666";
        }

        if (this.activeMainTab === 'unmapped') {
            const uniqueLines = new Set(this.transactions.map(t => t.lineItem)).size;
            statusText.innerText = `Mapping Manager: Reviewing ${uniqueLines} unique line items from this payroll batch.`;
            statusText.style.color = "#2c3e50";
            if(syncBtn) syncBtn.disabled = true;
            return;
        }

        const validData = this.transactions.filter(t => !t.selected);
        statusText.innerText = `Ready to push Payroll Journal Entry containing ${validData.length} active allocation lines.`;
        statusText.style.color = "#2c3e50";
        if(syncBtn && validData.length > 0) syncBtn.disabled = false;
    }

    showAlert(message, type = "warning") {
        const box = document.getElementById('alertBox');
        if(!box) return;
        box.innerHTML = message;
        box.className = `alert alert-${type} visible`;
    }

    hideAlert() {
        const box = document.getElementById('alertBox');
        if(box) box.className = "alert";
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

        Papa.parse(file, {
            header: false,
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
        let headerIdx = -1;
        for (let i = 0; i < Math.min(20, data.length); i++) {
            if (data[i].some(cell => cell && typeof cell === 'string' && cell.trim() === 'Employee Name')) {
                headerIdx = i;
                break;
            }
        }

        if (headerIdx === -1) {
            this.showAlert("<strong>Parse Error:</strong> Could not find the standard ADP header row containing 'Employee Name'.", "danger");
            return;
        }

        const headers = data[headerIdx].map(h => h ? h.trim() : '');

        const colIdx = {
            empName: headers.indexOf('Employee Name'),
            payFreq: headers.indexOf('Pay Frequency'),
            department: headers.indexOf('Department'),
            project: headers.indexOf('Project'),
            totalEarn: headers.indexOf('Total Earnings'),
            netPay: headers.indexOf('Net Pay'),
            eeTaxes: headers.indexOf('Total Taxes'),
            erTaxes: headers.indexOf('Total Employer Liability'),
            deductions: headers.indexOf('Deduction Total'),
            checkDate: headers.findIndex(h => h.includes('Check Date') || h.includes('Pay Date'))
        };

        const earningCols = [];
        const detailedEECols = [];
        const detailedERCols = [];

        // Flexible Regular Expressions for extracting specific taxes
        const eePatterns = [/^FED\sFIT$/i, /^FED\sSOCSEC$/i, /^FED\sMEDCARE$/i, /^[A-Z]{2}\s?SIT$/i, /^Advance$/i];
        const erPatterns = [/^FED\sSOCSEC-ER$/i, /^FED\sMEDCARE-ER$/i, /^FED\sFUTA$/i, /^[A-Z]{2}\s?SUI-ER$/i];

        for (let i = 0; i < headers.length; i++) {
            const h = headers[i];
            if (h.startsWith('Earning') && h.length >= 7) {
                if (headers[i + 3] === 'Amount') {
                    earningCols.push({ nameIdx: i, amountIdx: i + 3 });
                }
            }
            if (eePatterns.some(p => p.test(h))) {
                detailedEECols.push({ name: h, idx: i, isAdvance: /^Advance$/i.test(h) });
            }
            if (erPatterns.some(p => p.test(h))) {
                detailedERCols.push({ name: h, idx: i });
            }
        }

        let expandedTransactions = [];

        for (let i = headerIdx + 1; i < data.length; i++) {
            const row = data[i];
            const empName = row[colIdx.empName];
            
            if (!empName || empName.includes('Total') || empName.includes('Company') || empName === '') continue;

            const payFreq = colIdx.payFreq >= 0 ? (row[colIdx.payFreq] || 'Payroll').trim() : 'Payroll';
            const department = colIdx.department >= 0 ? (row[colIdx.department] || '').trim() : '';
            const deptStr = department ? ` - ${department}` : '';
            const project = colIdx.project >= 0 ? (row[colIdx.project] || '').trim() : '';
            const projStr = project ? ` - ${project}` : '';

            const totalEarn = this.parseAmt(row[colIdx.totalEarn]);
            const origErTaxes = this.parseAmt(row[colIdx.erTaxes]);
            const origEeTaxes = this.parseAmt(row[colIdx.eeTaxes]);
            const origDeductions = this.parseAmt(row[colIdx.deductions]);
            const netPay = this.parseAmt(row[colIdx.netPay]);
            const checkDate = colIdx.checkDate >= 0 ? row[colIdx.checkDate] : new Date().toISOString();

            if (totalEarn === 0 && origErTaxes === 0 && netPay === 0) continue;

            let dateStamp = this.formatDateStr(checkDate);
            const empEarnings = [];
            let calculatedEarnTotal = 0;

            for (let ec of earningCols) {
                const eName = row[ec.nameIdx];
                const eAmt = this.parseAmt(row[ec.amountIdx]);
                if (eName && eAmt !== 0) {
                    empEarnings.push({ name: eName.trim(), amount: eAmt });
                    calculatedEarnTotal += eAmt;
                }
            }

            const baseEarn = totalEarn !== 0 ? totalEarn : calculatedEarnTotal;

            // Extract dynamic detailed EE and ER Taxes to avoid double counting
            let detailedEETotal = 0;
            let detailedDeductionTotal = 0;
            let detailedERTotal = 0;

            const eeDetails = [];
            const erDetails = [];

            detailedEECols.forEach(col => {
                const amt = this.parseAmt(row[col.idx]);
                if (amt !== 0) {
                    eeDetails.push({ name: col.name, amount: amt, isAdvance: col.isAdvance });
                    if (col.isAdvance) detailedDeductionTotal += amt;
                    else detailedEETotal += amt;
                }
            });

            detailedERCols.forEach(col => {
                const amt = this.parseAmt(row[col.idx]);
                if (amt !== 0) {
                    erDetails.push({ name: col.name, amount: amt });
                    detailedERTotal += amt;
                }
            });

            // Adjust fallback summary totals
            let erTaxes = origErTaxes - detailedERTotal;
            if (Math.abs(erTaxes) < 0.01) erTaxes = 0;

            let eeTaxes = origEeTaxes - detailedEETotal;
            if (Math.abs(eeTaxes) < 0.01) eeTaxes = 0;

            let deductions = origDeductions - detailedDeductionTotal;
            if (Math.abs(deductions) < 0.01) deductions = 0;

            // Generate Primary Debits (Wages and generic ER allocation)
            empEarnings.forEach(earn => {
                const ratio = baseEarn !== 0 ? earn.amount / baseEarn : 0;
                const allocatedErTax = erTaxes * ratio;
                const earnNameClean = earn.name;

                const wageLineItem = `${payFreq} ${earnNameClean}${deptStr}${projStr}`;
                expandedTransactions.push({
                    uid: Date.now().toString(36) + Math.random().toString(36).substring(2),
                    postingType: 'Debit',
                    transactionType: 'Wage Expense',
                    lineItem: wageLineItem,
                    description: `Wages: ${empName}`,
                    project: project,
                    empName: empName,
                    amount: Math.abs(earn.amount),
                    date: dateStamp,
                    category: (this.categoriesDict[wageLineItem] || {}).category || "",
                    classId: "",
                    selected: false
                });

                if (allocatedErTax !== 0) {
                    const erTaxLineItem = `${payFreq} ${earnNameClean} - ER Taxes${deptStr}${projStr}`;
                    expandedTransactions.push({
                        uid: Date.now().toString(36) + Math.random().toString(36).substring(2),
                        postingType: 'Debit',
                        transactionType: 'ER Tax Allocation',
                        lineItem: erTaxLineItem,
                        description: `ER Taxes: ${empName}`,
                        project: project,
                        empName: empName,
                        amount: Math.abs(allocatedErTax),
                        date: dateStamp,
                        category: (this.categoriesDict[erTaxLineItem] || {}).category || "",
                        classId: "",
                        selected: false
                    });
                }
            });

            // Generate Generic Credits (Fallback)
            if (eeTaxes !== 0) {
                const li = `Payroll Liabilities - EE Taxes`;
                expandedTransactions.push({
                    uid: Date.now().toString(36) + Math.random().toString(36).substring(2),
                    postingType: 'Credit',
                    transactionType: 'EE Tax Payable',
                    lineItem: li,
                    description: `EE Taxes: ${empName}`,
                    project: project,
                    empName: empName,
                    amount: Math.abs(eeTaxes),
                    date: dateStamp,
                    category: (this.categoriesDict[li] || {}).category || "",
                    classId: "",
                    selected: false
                });
            }
            if (erTaxes !== 0) {
                const li = `Payroll Liabilities - ER Taxes`;
                expandedTransactions.push({
                    uid: Date.now().toString(36) + Math.random().toString(36).substring(2),
                    postingType: 'Credit',
                    transactionType: 'ER Tax Payable',
                    lineItem: li,
                    description: `ER Taxes: ${empName}`,
                    project: project,
                    empName: empName,
                    amount: Math.abs(erTaxes),
                    date: dateStamp,
                    category: (this.categoriesDict[li] || {}).category || "",
                    classId: "",
                    selected: false
                });
            }
            if (deductions !== 0) {
                const li = `Payroll Liabilities - Deductions`;
                expandedTransactions.push({
                    uid: Date.now().toString(36) + Math.random().toString(36).substring(2),
                    postingType: 'Credit',
                    transactionType: 'Other Deductions',
                    lineItem: li,
                    description: `Deductions: ${empName}`,
                    project: project,
                    empName: empName,
                    amount: Math.abs(deductions),
                    date: dateStamp,
                    category: (this.categoriesDict[li] || {}).category || "",
                    classId: "",
                    selected: false
                });
            }

            // Generate Specific / Detailed EE Tax Credits
            eeDetails.forEach(ee => {
                const li = `Payroll Liabilities - ${ee.name}`;
                expandedTransactions.push({
                    uid: Date.now().toString(36) + Math.random().toString(36).substring(2),
                    postingType: 'Credit',
                    transactionType: ee.isAdvance ? 'Other Deductions' : 'EE Tax Payable',
                    lineItem: li,
                    description: `${ee.name}: ${empName}`,
                    project: project,
                    empName: empName,
                    amount: Math.abs(ee.amount),
                    date: dateStamp,
                    category: (this.categoriesDict[li] || {}).category || "",
                    classId: "",
                    selected: false
                });
            });

            // Generate Specific / Detailed ER Debits & Credits
            erDetails.forEach(er => {
                // ER Expense (Debit)
                const liExp = `${payFreq} - ${er.name}${projStr}`;
                expandedTransactions.push({
                    uid: Date.now().toString(36) + Math.random().toString(36).substring(2),
                    postingType: 'Debit',
                    transactionType: 'ER Tax Allocation',
                    lineItem: liExp,
                    description: `${er.name}: ${empName}`,
                    project: project,
                    empName: empName,
                    amount: Math.abs(er.amount),
                    date: dateStamp,
                    category: (this.categoriesDict[liExp] || {}).category || "",
                    classId: "",
                    selected: false
                });

                // ER Liability (Credit)
                const liLiab = `Payroll Liabilities - ${er.name}`;
                expandedTransactions.push({
                    uid: Date.now().toString(36) + Math.random().toString(36).substring(2),
                    postingType: 'Credit',
                    transactionType: 'ER Tax Payable',
                    lineItem: liLiab,
                    description: `${er.name}: ${empName}`,
                    project: project,
                    empName: empName,
                    amount: Math.abs(er.amount),
                    date: dateStamp,
                    category: (this.categoriesDict[liLiab] || {}).category || "",
                    classId: "",
                    selected: false
                });
            });

            if (netPay !== 0) {
                const li = `Net Pay Clearing`;
                expandedTransactions.push({
                    uid: Date.now().toString(36) + Math.random().toString(36).substring(2),
                    postingType: 'Credit',
                    transactionType: 'Net Pay (Cash)',
                    lineItem: li,
                    description: `Net Pay: ${empName}`,
                    project: project,
                    empName: empName,
                    amount: Math.abs(netPay),
                    date: dateStamp,
                    category: (this.categoriesDict[li] || {}).category || "",
                    classId: "",
                    selected: false
                });
            }
        }

        const isGuest = !this.userProfile || this.userProfile.role === 'guest';
        if (isGuest && expandedTransactions.length > 50) {
            expandedTransactions = expandedTransactions.slice(0, 50);
            this.showAlert("Guest Mode: Parsing truncated to 50 allocation lines. Please upgrade via Subscriptions for unlimited processing.", "info");
        }

        this.transactions = expandedTransactions;
        document.getElementById('syncQboBtn').disabled = false;
        
        this.renderActiveView();
    }

    renderTable() {
        const currentData = this.transactions.filter(t => !t.selected); 
        
        let html = `
            <div style="margin-bottom: 10px; display:flex; justify-content:space-between; align-items:center;">
                <span style="font-size:0.9rem; color:#666;">Showing ${currentData.length} allocation lines based on payroll breakdown.</span>
            </div>
            <div class="table-responsive">
            <table><thead><tr>
                <th style="width: 40px;"><input type="checkbox" id="selectAllCb" onchange="window.toggleSelectAll(this.checked)"></th>
                <th>Posting</th>
                <th>Line Item Identifier</th>
                <th>Category (QBO)</th>
                <th>Class (QBO)</th>
                <th>Employee Name</th>
                <th>Project</th>
                <th>Description</th>
                <th style="text-align: right;">Amount</th>
                <th>Check Date</th>
            </tr></thead><tbody>
        `;

        if (currentData.length === 0) {
            html += `<tr><td colspan="10" style="text-align:center; padding:2rem;">No data available.</td></tr>`;
        }

        currentData.forEach((t) => {
            let catDisplay = t.category;
            const liveMatch = this.qboAccounts.find(a => a.name.toLowerCase() === t.lineItem.toLowerCase());
            if (liveMatch && !t.category) {
                catDisplay = liveMatch.name;
                t.category = liveMatch.name;
            } else if (!t.category) {
                catDisplay = `<span class="text-danger">Unmapped</span>`;
            }

            const postColor = t.postingType === 'Debit' ? '#27ae60' : '#e74c3c';

            let classDropdown = `<select onchange="window.updateLineClass('${t.uid}', this.value)" style="padding: 0.2rem; max-width: 120px; border-radius: 3px; border: 1px solid #ccc;">
                <option value="">None</option>
                ${this.qboClasses.map(c => `<option value="${c.id}" ${t.classId === c.id ? 'selected' : ''}>${c.name}</option>`).join('')}
            </select>`;

            html += `<tr>
                <td><input type="checkbox" class="row-checkbox" data-uid="${t.uid}" ${t.selected ? 'checked' : ''} onchange="window.toggleRow('${t.uid}', this.checked)"></td>
                <td style="color:${postColor}; font-weight:bold;">${t.postingType}</td>
                <td><strong>${t.lineItem}</strong></td>
                <td>${catDisplay}</td>
                <td>${classDropdown}</td>
                <td>${t.empName}</td>
                <td>${t.project || '-'}</td>
                <td><span style="font-size: 0.8rem; color: #555;">${t.description}</span></td>
                <td style="text-align: right; font-weight: bold;">${t.amount.toFixed(2)}</td>
                <td>${t.date}</td>
            </tr>`;
        });

        html += `</tbody></table></div>`;
        document.getElementById('tabContent').innerHTML = html;

        window.toggleSelectAll = (checked) => {
            this.transactions.forEach(t => t.selected = checked);
            document.querySelectorAll('.row-checkbox').forEach(cb => cb.checked = checked);
            this.renderActiveView(); 
        };
        
        window.toggleRow = (uid, checked) => {
            const masterRow = this.transactions.find(t => t.uid === uid);
            if (masterRow) masterRow.selected = checked;
        };

        window.updateLineClass = (uid, classId) => {
            const masterRow = this.transactions.find(t => t.uid === uid);
            if (masterRow) masterRow.classId = classId;
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
                <span style="font-size:0.9rem; color:#666;">Showing all ${uniqueLineItems.size} unique payroll line items required for this upload.</span>
            </div>
            <div class="table-responsive">
            <table class="costing-table data-table" style="width:100% !important; min-width: 1000px !important;"><thead><tr>
                <th style="text-align:left; width:25%;">Line Item ID</th>
                <th style="text-align:left; width:30%;">Target QBO Account Name</th>
                <th style="text-align:left; width:20%;">QBO Account Type</th>
                <th style="text-align:center; width:15%;">Status</th>
                <th style="text-align:center; width:10%;">Action</th>
            </tr></thead><tbody>
        `;

        if (uniqueLineItems.size === 0) {
            html += `<tr><td colspan="5" style="text-align:center; padding: 2rem; color: #666;">No line items found. Upload a CSV.</td></tr>`;
        }

        const isGuest = this.userRole === 'guest';
        let i = 0;

        uniqueLineItems.forEach(lineItem => {
            const accMatch = this.qboAccounts.find(acc => acc.name.toLowerCase() === lineItem.toLowerCase());
            const accInQbo = !!accMatch;

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
            let defaultType = 'Expense'; 
            if (lowerLine.includes('taxes') || lowerLine.includes('deductions') || lowerLine.includes('liabilities')) defaultType = 'Other Current Liability';
            if (lowerLine.includes('net pay')) defaultType = 'Bank';

            fullAccountTypes.forEach(t => {
                const selected = accMatch && accMatch.type === t ? 'selected' : (t === defaultType ? 'selected' : '');
                typeDropdownHtml += `<option value="${t}" ${selected}>${t}</option>`;
            });
            typeDropdownHtml += `</select>`;

            let statusHtml = '';
            if (accInQbo) statusHtml += `<div class="qbo-badge">✅ Account in QBO</div>`;
            if (!accInQbo) statusHtml = `<span style="color:#e74c3c; font-size:0.8rem;">Unmapped</span>`;

            const isDisabled = accInQbo;

            html += `<tr>
                <td style="white-space:normal; word-wrap: break-word;"><strong>${lineItem}</strong></td>
                <td>${accDropdownHtml}</td>
                <td>${typeDropdownHtml}</td>
                <td style="text-align:center;">${statusHtml}</td>
                <td style="text-align:center; display:flex; gap:5px; justify-content:center;">
                    <button class="btn" style="background:${isDisabled ? '#95a5a6' : '#27ae60'}; color:white; font-weight:bold; padding:0.4rem 0.8rem; border-radius:3px; border:none; cursor:${isDisabled ? 'not-allowed' : 'pointer'};" onclick="window.pushToQboMapping('${lineItem}', ${i})" ${isDisabled ? 'disabled' : ''}>Save to QBO</button>
                </td>
            </tr>`;
            i++;
        });

        html += `</tbody></table></div>`;
        const tabContent = document.getElementById('tabContent');
        if (tabContent) tabContent.innerHTML = html;

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
            const accSelect = document.getElementById(`unmap-cat-${index}`);
            const accDropdownVal = accSelect.value;
            const newAccName = document.getElementById(`new-cat-name-${index}`).value.trim();
            const accTypeVal = document.getElementById(`unmap-type-${index}`).value;
            const btn = event.target;

            const qboSelect = document.getElementById('qboSelect');
            if (!qboSelect || !qboSelect.value) return this.showAlert("Please connect a QBO account first.", "warning");

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
                    await getOrCreateQboAccount({ 
                        accountName: finalAccName, 
                        realmId: realmId, 
                        accountType: accTypeVal 
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

    renderJournal() {
        const validData = this.transactions.filter(t => !t.selected);

        if (validData.length === 0) {
            let html = `
                <div class="table-responsive">
                <table><thead><tr>
                    <th>Account / Category</th>
                    <th>Class</th>
                    <th style="text-align: right;">Debit</th>
                    <th style="text-align: right;">Credit</th>
                    <th>Line Description</th>
                </tr></thead><tbody>
                <tr><td colspan="5" style="text-align:center;">No data matches the current filters.</td></tr>
                </tbody></table></div>`;
            const tabContent = document.getElementById('tabContent');
            if(tabContent) tabContent.innerHTML = html;
            return;
        }

        // Group by Date for Summary
        const groups = {};
        validData.forEach(t => {
            const d = t.date || 'Unknown Date';
            if (!groups[d]) groups[d] = [];
            groups[d].push(t);
        });

        let html = ``;

        for (const [dateStr, lines] of Object.entries(groups)) {
            html += `<h4 style="margin-top: 15px; margin-bottom: 10px; color: #2c3e50;">Journal Entry Date: <span style="font-weight: normal;">${dateStr}</span></h4>`;
            html += `
                <div class="table-responsive" style="margin-bottom: 20px;">
                <table><thead><tr>
                    <th>Account / Category</th>
                    <th>Class</th>
                    <th style="text-align: right;">Debit</th>
                    <th style="text-align: right;">Credit</th>
                    <th>Line Description</th>
                </tr></thead><tbody>
            `;

            // Detailed Grouping: preserves Employee and Class assignments in Journal View
            let summary = {};
            lines.forEach(t => {
                const key = `${t.empName}_${t.postingType}_${t.category}_${t.classId || 'none'}`;
                if (!summary[key]) summary[key] = { 
                    catName: t.category || `<span class="text-danger">Missing Mapping</span>`, 
                    amt: 0, 
                    post: t.postingType, 
                    desc: `Payroll: ${t.empName}`,
                    className: this.qboClasses.find(c => c.id === t.classId)?.name || `<span style="color:#aaa; font-style:italic;">None</span>`
                };
                summary[key].amt += t.amount;
            });

            let totalDebit = 0;
            let totalCredit = 0;

            const sortedKeys = Object.keys(summary).sort((a, b) => a.startsWith('Debit') ? -1 : 1);

            sortedKeys.forEach(key => {
                const line = summary[key];
                if (line.amt < 0.01) return;

                const debitStr = line.post === 'Debit' ? line.amt.toFixed(2) : "";
                const creditStr = line.post === 'Credit' ? line.amt.toFixed(2) : "";
                
                if(line.post === 'Debit') totalDebit += line.amt;
                if(line.post === 'Credit') totalCredit += line.amt;

                html += `<tr><td>${line.catName}</td><td>${line.className}</td><td style="text-align: right; color:#27ae60; font-weight:bold;">${debitStr}</td><td style="text-align: right; color:#e74c3c; font-weight:bold;">${creditStr}</td><td>${line.desc}</td></tr>`;
            });

            const diff = Math.abs(totalDebit - totalCredit);
            const balanceWarning = diff > 0.05 ? `<span style="color:#e74c3c; font-size:0.8rem; margin-left: 10px;">(Out of Balance by $${diff.toFixed(2)})</span>` : `<span style="color:#27ae60; font-size:0.8rem; margin-left: 10px;">(Balanced)</span>`;

            html += `<tr style="font-weight:bold; background:#e9ecef">
                <td colspan="2">TOTAL ${balanceWarning}</td>
                <td style="text-align: right;">${totalDebit.toFixed(2)}</td>
                <td style="text-align: right;">${totalCredit.toFixed(2)}</td>
                <td></td>
            </tr>`;
            html += `</tbody></table></div>`;
        }

        const tabContent = document.getElementById('tabContent');
        if (tabContent) tabContent.innerHTML = html;
    }

    async handlePushToQbo() {
        if (this.userRole === 'guest' && this.userProfile.monthlyBatchesPushed >= 10) {
            return this.showAlert("Monthly push limit reached (10/10). Please subscribe in the UI to continue pushing data.", "danger");
        }

        const qboSelect = document.getElementById('qboSelect');
        if (!qboSelect || !qboSelect.value) return this.showAlert("Please connect and select a QBO account first.", "warning");

        const visibleData = this.transactions.filter(t => !t.selected);
        if (visibleData.length === 0) return this.showAlert("No active transactions available to push.", "warning");

        // Validate mappings
        let missingMap = false;
        visibleData.forEach(t => { if (!t.category) missingMap = true; });
        if(missingMap) return this.showAlert("You have unmapped line items. Please map all accounts in the Mapping Tab before pushing.", "danger");

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

        try {
            const config = {
                realmId: qboSelect.value,
                functions: functions,
                batchId: `payroll_${Date.now()}` 
            };

            const getOrCreateQboAccount = httpsCallable(config.functions, 'getOrCreateQboAccount');

            // Group by Date for Summary
            const groups = {};
            visibleData.forEach(t => {
                const d = t.date || 'Unknown Date';
                if (!groups[d]) groups[d] = [];
                groups[d].push(t);
            });

            let pushedIds = [];

            for (const [dateStr, lines] of Object.entries(groups)) {
                
                // BRANCH 1: Push as Individual Checks per Employee
                if (this.activeSubTab === 'table') {
                    const pushCheck = httpsCallable(config.functions, 'pushCheck'); 
                    
                    const empGroups = {};
                    lines.forEach(t => {
                        if (!empGroups[t.empName]) empGroups[t.empName] = [];
                        empGroups[t.empName].push(t);
                    });

                    for (const [empName, empLines] of Object.entries(empGroups)) {
                        const qboLines = [];
                        for (const t of empLines) {
                            if (Math.abs(t.amount) < 0.01) continue;
                            const catResponse = await getOrCreateQboAccount({ accountName: t.category, realmId: config.realmId });
                            qboLines.push({
                                postingType: t.postingType,
                                amount: t.amount,
                                qboAccountId: catResponse.data.id,
                                description: t.lineItem,
                                classId: t.classId || "",
                                entityName: empName
                            });
                        }
                        
                        const response = await pushCheck({ realmId: config.realmId, lines: qboLines, txnDate: dateStr, payeeName: empName, privateNote: `Imported via VilBooks - ADP Payroll Check` });
                        if (response.data.success) {
                            pushedIds.push({ type: "Check", id: response.data.qboResponseId });
                        }
                    }
                } 
                // BRANCH 2: Push as Highly Detailed Journal Entry
                else {
                    const pushJournalEntry = httpsCallable(config.functions, 'pushJournalEntry');
                    
                    const summary = {};
                    lines.forEach(t => {
                        const key = `${t.empName}_${t.postingType}_${t.category}_${t.classId || 'none'}`;
                        if (!summary[key]) summary[key] = { amt: 0, post: t.postingType, cat: t.category, classId: t.classId, empName: t.empName };
                        summary[key].amt += t.amount;
                    });

                    const qboLines = [];
                    for (const [key, lineData] of Object.entries(summary)) {
                        if (Math.abs(lineData.amt) < 0.01) continue; 
                        
                        const catResponse = await getOrCreateQboAccount({ accountName: lineData.cat, realmId: config.realmId });
                        qboLines.push({ 
                            postingType: lineData.post, 
                            amount: lineData.amt, 
                            qboAccountId: catResponse.data.id, 
                            description: `ADP Payroll: ${lineData.empName}`,
                            classId: lineData.classId || "",
                            entityName: lineData.empName || ""
                        });
                    }

                    // Balance enforcement check for Journal Entry
                    const debits = qboLines.filter(l => l.postingType === 'Debit').reduce((s, l) => s + l.amount, 0);
                    const credits = qboLines.filter(l => l.postingType === 'Credit').reduce((s, l) => s + l.amount, 0);
                    
                    if (Math.abs(debits - credits) > 0.05) {
                        throw new Error(`The aggregated journal entry for ${dateStr} is out of balance by $${Math.abs(debits - credits).toFixed(2)}. This prevents QBO from accepting the entry. Please check your raw file integrity.`);
                    }

                    const response = await pushJournalEntry({ realmId: config.realmId, lines: qboLines, txnDate: dateStr, privateNote: `Imported via VilBooks - Detailed ADP Payroll Run` });
                    if (response.data.success) {
                        pushedIds.push({ type: "JournalEntry", id: response.data.qboResponseId });
                    }
                }
            }

            if (pushedIds && pushedIds.length > 0) {
                await setDoc(doc(db, `qbo_companies/${config.realmId}/transPushedToQB`, config.batchId), {
                    timestamp: new Date().toISOString(),
                    realmId: config.realmId,
                    tab: 'Payroll',
                    view: this.activeSubTab === 'table' ? 'Checks (Data View)' : 'Journal Summary',
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
                
                const entryType = this.activeSubTab === 'table' ? "Checks" : "Journal Entries";
                if (statusText) statusText.innerText = `Push completed successfully! ${pushedIds.length} ${entryType} saved to QBO.`;
                this.showAlert(`Success! ${pushedIds.length} ${entryType} were pushed to QuickBooks.`, "success");
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
            pushBtn.innerText = originalText;
            pushBtn.disabled = false;
        }
    }

    async loadBatchHistory() {
        const qboSelect = document.getElementById('qboSelect');
        if (!qboSelect || !qboSelect.value) return;
        const container = document.getElementById('historyTableContainer');
        if(!container) return;
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
                            <th style="padding: 10px; border-bottom: 2px solid #ddd;">Entries Created</th>
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
            const historyContainer = document.getElementById('historyTableContainer');
            if (historyContainer) historyContainer.innerHTML = "<p>Deleting batch from QuickBooks... Please wait.</p>";
            
            const res = await deleteQboBatch({ batchId: batchId, realmId: realmId });
            
            alert(`Success: ${res.data.deletedCount} transactions were removed from QuickBooks.`);
            this.loadBatchHistory(); 
        } catch (err) {
            alert(`Failed to delete batch: ${err.message}`);
            this.loadBatchHistory(); 
        }
    }
}
