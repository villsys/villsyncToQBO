// bulkDeleteTransaction.js
import { db, functions } from './auth.js';
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/12.11.0/firebase-firestore.js";
import { httpsCallable } from "https://www.gstatic.com/firebasejs/12.11.0/firebase-functions.js";
import { currentUser } from './app.js';

export default class BulkDeleteTransaction {
    constructor() {
        this.transactions = [];
        this.userRole = 'guest';
        this.selectedType = 'JournalEntry';
    }

    async render() {
        return `
            <style>
                :root {
                    --header-bg: #1F4E78; --header-text: #FFFFFF;
                    --accent-bg: #D9E1F2; --border-color: #D9D9D9;
                    --btn-fetch: #3498db; --btn-del: #e74c3c;
                }
                .dashboard { width: 100%; background: #fff; padding: 20px; box-shadow: 0 4px 15px rgba(0,0,0,0.1); border-radius: 8px; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; box-sizing: border-box; }
                .dashboard h2 { color: var(--header-bg); font-size: 1.4rem; margin-top: 0; margin-bottom: 5px; }
                .subtitle { color: #666; font-size: 0.85rem; margin-top: 0; margin-bottom: 20px; }
                
                .control-bar { display: flex; gap: 15px; background: #f8f9fa; padding: 15px; border: 1px solid var(--border-color); border-radius: 5px; margin-bottom: 15px; align-items: center; flex-wrap: wrap; }
                .control-bar label { font-weight: bold; font-size: 0.9rem; color: #2c3e50; }
                .control-bar select, .control-bar input[type="date"] { padding: 6px; border: 1px solid #ccc; border-radius: 4px; }
                
                .btn { padding: 8px 16px; border: none; border-radius: 4px; font-weight: bold; cursor: pointer; color: white; transition: opacity 0.2s; }
                .btn:disabled { opacity: 0.5; cursor: not-allowed; }
                .btn-fetch { background-color: var(--btn-fetch); }
                .btn-del { background-color: var(--btn-del); margin-left: auto; }
                
                .status-bar { background: #fff3cd; border-left: 4px solid #ffc107; padding: 8px 15px; margin-bottom: 15px; border-radius: 4px; display: flex; justify-content: space-between; align-items: center; font-size: 0.9rem; }
                
                table.data-table { border-collapse: collapse; width: 100%; font-size: 0.85rem; min-width: 800px; }
                table.data-table th, table.data-table td { border: 1px solid var(--border-color); padding: 8px; text-align: left; }
                table.data-table th { background-color: var(--header-bg); color: var(--header-text); position: sticky; top: 0; z-index: 10; }
                table.data-table tbody tr:hover { background-color: #f1f5f9; }
                table.data-table .num { text-align: right; font-family: monospace; font-size: 0.9rem; }
                .table-responsive { width: 100%; overflow-x: auto; max-height: 500px; overflow-y: auto; border: 1px solid var(--border-color); }
            </style>

            <div class="container" style="padding-top: 0.25rem;">
                <div class="dashboard">
                    <h2>VillSync to QBO: Bulk Delete Utility</h2>
                    <p class="subtitle">Fetch transactions directly from QuickBooks Online and permanently delete them in bulk.</p>
                    
                    <div id="alertBox" class="alert" style="margin-bottom: 10px; padding: 0.4rem; display: none;"></div>

                    <div id="statusBar" class="status-bar">
                        <span id="statusText" style="color: #856404; font-weight: bold;">Loading user profile...</span>
                        <span id="roleText" style="color: #666; font-weight: bold;"></span>
                    </div>

                    <div class="control-bar">
                        <div>
                            <label>Transaction Type:</label><br>
                            <select id="txnType">
                                <option value="JournalEntry">Journal Entries</option>
                                <option value="SalesReceipt">Sales Receipts</option>
                                <option value="RefundReceipt">Refund Receipts</option>
                                <option value="Deposit">Deposits</option>
                                <option value="Purchase">Expenses / Purchases</option>
                                <option value="Invoice">Invoices</option>
                                <option value="Payment">Payments</option>
                                <option value="Bill">Bills</option>
                                <option value="BillPayment">Bill Payments</option>
                                <option value="InventoryAdjustment">Inventory Adjustments</option>
                            </select>
                        </div>
                        <div>
                            <label>Start Date:</label><br>
                            <input type="date" id="startDate">
                        </div>
                        <div>
                            <label>End Date:</label><br>
                            <input type="date" id="endDate">
                        </div>
                        <div style="align-self: flex-end;">
                            <button id="fetchBtn" class="btn btn-fetch">📥 Fetch Transactions</button>
                        </div>
                        <div style="align-self: flex-end; margin-left: auto;">
                            <button id="deleteBtn" class="btn btn-del" disabled>🗑️ Delete Selected</button>
                        </div>
                    </div>

                    <div id="quickSelectBar" style="display: none; margin-bottom: 10px; align-items: center; gap: 10px; flex-wrap: wrap;">
                        <span style="font-size:0.9rem; font-weight:bold; color:#2c3e50;">Quick Select:</span>
                        <button class="btn outline" style="padding:4px 8px; font-size:0.8rem; background:white; border:1px solid #ccc; color:#2c3e50; border-radius:3px; cursor:pointer;" onclick="window.selectTopN(50)">Top 50</button>
                        <button class="btn outline" style="padding:4px 8px; font-size:0.8rem; background:white; border:1px solid #ccc; color:#2c3e50; border-radius:3px; cursor:pointer;" onclick="window.selectTopN(100)">Top 100</button>
                        <button class="btn outline" style="padding:4px 8px; font-size:0.8rem; background:white; border:1px solid #ccc; color:#2c3e50; border-radius:3px; cursor:pointer;" onclick="window.selectTopN(150)">Top 150</button>
                        <button class="btn outline" style="padding:4px 8px; font-size:0.8rem; background:white; border:1px solid #ccc; color:#2c3e50; border-radius:3px; cursor:pointer;" onclick="window.selectTopN(200)">Top 200</button>
                        <button class="btn outline" style="padding:4px 8px; font-size:0.8rem; background:white; border:1px solid #ccc; color:#2c3e50; border-radius:3px; cursor:pointer;" onclick="window.selectTopN('ALL')">Select All</button>
                        <button class="btn outline" style="padding:4px 8px; font-size:0.8rem; background:white; border:1px solid #ccc; color:#2c3e50; border-radius:3px; cursor:pointer;" onclick="window.selectTopN(0)">Clear Selection</button>
                        <span id="rowCountDisplay" style="margin-left: auto; font-size:0.9rem; color:#666; font-weight:bold;"></span>
                    </div>

                    <div class="table-responsive">
                        <table class="data-table" id="txnTable">
                            <thead>
                                <tr>
                                    <th style="width: 40px; text-align: center;"><input type="checkbox" id="selectAllCb"></th>
                                    <th style="width: 100px;">Date</th>
                                    <th style="width: 120px;">Doc Number / ID</th>
                                    <th>Name / Entity</th>
                                    <th>Memo / Note</th>
                                    <th style="width: 120px; text-align: right;">Amount</th>
                                </tr>
                            </thead>
                            <tbody id="txnBody">
                                <tr><td colspan="6" style="text-align: center; padding: 2rem; color: #666;">Select a Date Range and click "Fetch Transactions" to load data from QBO.</td></tr>
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>
        `;
    }

    async afterRender() {
        if (!currentUser) return;
        await this.checkUserRole();

        // DEFENSIVE BINDING: Check if elements exist before attaching listeners
        const fetchBtn = document.getElementById('fetchBtn');
        if (fetchBtn) fetchBtn.addEventListener('click', () => this.fetchData());

        const deleteBtn = document.getElementById('deleteBtn');
        if (deleteBtn) deleteBtn.addEventListener('click', () => this.deleteSelected());
        
        const selectAllCb = document.getElementById('selectAllCb');
        if (selectAllCb) {
            selectAllCb.addEventListener('change', (e) => {
                const isChecked = e.target.checked;
                this.transactions.forEach(t => t.selected = isChecked);
                document.querySelectorAll('.row-cb').forEach(cb => cb.checked = isChecked);
                this.updateDeleteButton();
            });
        }

        // Whenever they change the type, clear the table to avoid confusion
        const txnTypeSelect = document.getElementById('txnType');
        if (txnTypeSelect) {
            txnTypeSelect.addEventListener('change', (e) => {
                this.selectedType = e.target.value;
                this.transactions = [];
                this.renderTable();
            });
        }
    }

    async checkUserRole() {
        this.userRole = 'guest'; 
        
        // 1. Check for Master Super Admin
        if (currentUser.email === 'vnvcpas.excelimporter@gmail.com') {
            this.userRole = 'super_admin';
        } else {
            // 2. Check for Tool-Specific Admin (Strict Tool Array Format)
            try {
                const adminDoc = await getDoc(doc(db, "global_config", "admins"));
                if (adminDoc.exists()) {
                    const adminData = adminDoc.data()[currentUser.email];
                    // Verify the user is an admin AND they have 'bulkDelete' in their tools array
                    if (adminData && typeof adminData === 'object' && Array.isArray(adminData.tools) && adminData.tools.includes('bulkDelete')) {
                        this.userRole = 'admin';
                    }
                }
            } catch (e) {}
        }

        const roleText = document.getElementById('roleText');
        const statusText = document.getElementById('statusText');
        
        if (this.userRole !== 'guest') {
            if (roleText) roleText.innerHTML = `<span style="color:#27ae60;">Admin | Authorized to Delete</span>`;
            if (statusText) statusText.innerText = "Ready to fetch and manage QBO data.";
        } else {
            if (roleText) roleText.innerHTML = `<span style="color:#e74c3c;">Guest | View Only</span>`;
            if (statusText) statusText.innerText = "Only admin users are allowed to execute bulk deletions.";
        }
    }

    showAlert(message, type = "warning") {
        const box = document.getElementById('alertBox');
        if (!box) return;
        box.innerHTML = message;
        box.className = `alert alert-${type}`;
        box.style.display = 'block';
    }

    async fetchData() {
        const qboSelect = document.getElementById('qboSelect');
        if (!qboSelect || !qboSelect.value) return this.showAlert("Please connect and select a QBO account from the top menu first.", "warning");

        const startDate = document.getElementById('startDate').value;
        const endDate = document.getElementById('endDate').value;

        if (!startDate || !endDate) {
            return this.showAlert("For safety reasons, you must select a Start and End Date before fetching data.", "warning");
        }

        const fetchBtn = document.getElementById('fetchBtn');
        fetchBtn.innerText = "Fetching..."; fetchBtn.disabled = true;
        this.showAlert(`Fetching ${this.selectedType}s from QBO...`, "info");

        try {
            const fetchQboTransactions = httpsCallable(functions, 'fetchQboTransactions');
            const res = await fetchQboTransactions({
                realmId: qboSelect.value,
                txnType: this.selectedType,
                startDate: startDate,
                endDate: endDate
            });

            this.transactions = res.data.transactions.map(t => ({ ...t, selected: false }));
            
            this.renderTable();
            this.showAlert(`Successfully loaded ${this.transactions.length} transactions.`, "success");
            
            setTimeout(() => { 
                const alertBox = document.getElementById('alertBox');
                if(alertBox) alertBox.style.display = 'none'; 
            }, 3000);

        } catch (error) {
            this.showAlert(`Fetch Failed: ${error.message}`, "danger");
        } finally {
            fetchBtn.innerText = "📥 Fetch Transactions"; fetchBtn.disabled = false;
        }
    }

    renderTable() {
        const tbody = document.getElementById('txnBody');
        const quickSelectBar = document.getElementById('quickSelectBar');
        const rowCountDisplay = document.getElementById('rowCountDisplay');
        
        const selectAllCb = document.getElementById('selectAllCb');
        if (selectAllCb) selectAllCb.checked = false;
        this.updateDeleteButton();

        if (this.transactions.length === 0) {
            if (tbody) tbody.innerHTML = `<tr><td colspan="6" style="text-align: center; padding: 2rem; color: #666;">No transactions found for the selected dates.</td></tr>`;
            if (quickSelectBar) quickSelectBar.style.display = 'none';
            return;
        }

        if (quickSelectBar) quickSelectBar.style.display = 'flex';
        if (rowCountDisplay) rowCountDisplay.innerText = `Total Extracted: ${this.transactions.length} rows`;

        let html = '';
        this.transactions.forEach(t => {
            html += `
                <tr>
                    <td style="text-align: center;"><input type="checkbox" class="row-cb" data-id="${t.id}" onchange="window.toggleDeleteRow('${t.id}', this.checked)"></td>
                    <td>${t.date}</td>
                    <td>${t.docNumber}</td>
                    <td><strong>${t.name}</strong></td>
                    <td><span style="font-size:0.8rem; color:#555;">${t.privateNote}</span></td>
                    <td class="num">${parseFloat(t.amount).toLocaleString('en-US', {minimumFractionDigits: 2})}</td>
                </tr>
            `;
        });
        
        if (tbody) tbody.innerHTML = html;

        window.toggleDeleteRow = (id, isChecked) => {
            const row = this.transactions.find(t => t.id === id);
            if (row) row.selected = isChecked;
            
            const allChecked = this.transactions.every(t => t.selected);
            const masterCb = document.getElementById('selectAllCb');
            if (masterCb) masterCb.checked = allChecked;
            this.updateDeleteButton();
        };

        window.selectTopN = (n) => {
            const limit = n === 'ALL' ? this.transactions.length : parseInt(n, 10);
            
            this.transactions.forEach((t, i) => {
                t.selected = (i < limit);
            });
            
            document.querySelectorAll('.row-cb').forEach((cb, i) => {
                cb.checked = (i < limit);
            });
            
            const allChecked = this.transactions.length > 0 && this.transactions.every(t => t.selected);
            const masterCb = document.getElementById('selectAllCb');
            if (masterCb) masterCb.checked = allChecked;
            
            this.updateDeleteButton();
        };
    }

    updateDeleteButton() {
        const delBtn = document.getElementById('deleteBtn');
        if (!delBtn) return;

        const selectedCount = this.transactions.filter(t => t.selected).length;
        
        if (this.userRole === 'guest') {
            delBtn.disabled = true;
            delBtn.innerText = "🗑️ Restricted (Guest)";
            return;
        }

        if (selectedCount > 0) {
            delBtn.disabled = false;
            delBtn.innerText = `🗑️ Delete ${selectedCount} Selected`;
        } else {
            delBtn.disabled = true;
            delBtn.innerText = `🗑️ Delete Selected`;
        }
    }

    async deleteSelected() {
        const itemsToDelete = this.transactions.filter(t => t.selected);
        if (itemsToDelete.length === 0) return;

        const confirmMsg = `WARNING: You are about to permanently delete ${itemsToDelete.length} ${this.selectedType}s from QuickBooks. This action CANNOT be undone.\n\nType "DELETE" to confirm.`;
        if (prompt(confirmMsg) !== 'DELETE') return;

        const qboSelect = document.getElementById('qboSelect');
        const delBtn = document.getElementById('deleteBtn');
        
        if (delBtn) {
            delBtn.innerText = "Executing Deletion..."; 
            delBtn.disabled = true;
        }

        try {
            const bulkDeleteQboTransactions = httpsCallable(functions, 'bulkDeleteQboTransactions');
            
            const chunkSize = 20; 
            let totalDeleted = 0;
            let allFailedIds = [];

            for (let i = 0; i < itemsToDelete.length; i += chunkSize) {
                const chunk = itemsToDelete.slice(i, i + chunkSize);
                const currentEnd = Math.min(i + chunkSize, itemsToDelete.length);
                
                this.showAlert(`Deleting transactions ${i + 1} to ${currentEnd} out of ${itemsToDelete.length}. Please do not close this window...`, "warning");

                const res = await bulkDeleteQboTransactions({
                    realmId: qboSelect.value,
                    txnType: this.selectedType,
                    itemsToDelete: chunk.map(t => ({ id: t.id, syncToken: t.syncToken }))
                });

                totalDeleted += res.data.deletedCount;
                allFailedIds = allFailedIds.concat(res.data.failedIds || []);

                this.transactions = this.transactions.filter(t => !t.selected || allFailedIds.includes(t.id));
                this.renderTable();
            }

            if (allFailedIds.length > 0) {
                this.showAlert(`Deleted ${totalDeleted} items, but failed to delete ${allFailedIds.length} items. They may be locked by closed accounting periods or already deleted.`, "warning");
            } else {
                this.showAlert(`Success! ${totalDeleted} transactions were permanently deleted from QBO.`, "success");
            }

        } catch (error) {
            this.showAlert(`Deletion Failed during batch processing: ${error.message}`, "danger");
        } finally {
            this.updateDeleteButton();
        }
    }
}
