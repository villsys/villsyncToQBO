import { db, functions } from './auth.js';
import { collection, doc, getDoc, setDoc, getDocs, writeBatch } from "https://www.gstatic.com/firebasejs/12.11.0/firebase-firestore.js";
import { httpsCallable } from "https://www.gstatic.com/firebasejs/12.11.0/firebase-functions.js";
import { currentUser } from './app.js';

export default class ProductCostBuilder {
    constructor() {
        this.activeMainTab = "general_journal";
        this.batchData = {
            batchId: Date.now().toString(),
            clientName: "",
            productName: "",
            isComplete: false
        };
        
        // Dropdown Data
        this.rawMaterials = [];
        this.productionStages = [];
        this.laborItems = [];
        this.overheadItems = [];
        
        // QBO Live Data
        this.qboAccounts = [];
        this.qboItems = [];
        this.uniqueLineItems = new Set();
        this.userRole = 'guest'; 
    }

    async render() {
        return `
            <style>
                :root {
                    --header-bg: #1F4E78; --header-text: #FFFFFF;
                    --input-bg: #FFF2CC; --calc-bg: #F2F2F2;
                    --accent-bg: #D9E1F2; --border-color: #D9D9D9;
                    --btn-bg: #28a745; --btn-del: #dc3545;
                }
                
                .costing-dashboard { width: 100%; background: #fff; padding: 15px; box-shadow: 0 4px 15px rgba(0,0,0,0.1); border-radius: 8px; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; box-sizing: border-box; overflow: hidden; }
                .costing-dashboard h2 { color: var(--header-bg); font-size: 14px; margin-top: 15px; margin-bottom: 5px; text-transform: uppercase; }
                
                .main-layout { display: flex; gap: 20px; flex-wrap: wrap; align-items: flex-start; width: 100%; }
                .left-column { flex: 2.3; min-width: 0; display: flex; flex-direction: column; gap: 10px; }
                .right-column { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 10px; }
                
                .table-responsive { width: 100%; overflow-x: auto; margin-bottom: 10px; display: block; }
                
                table.costing-table { border-collapse: collapse !important; font-size: 0.85rem !important; width: 100% !important; min-width: 0 !important; }
                table.costing-table th, table.costing-table td { border: 1px solid var(--border-color); padding: 4px 8px; text-align: left; }
                table.costing-table th { background-color: var(--header-bg); color: var(--header-text); text-align: center; font-weight: normal; }
                
                table.simple-table { table-layout: auto !important; }
                table.simple-table td.label-cell { width: 1%; min-width: 220px; white-space: normal; padding-right: 15px !important; background-color: var(--accent-bg); font-weight: bold; line-height: 1.2; }
                table.simple-table td:nth-child(2) { padding: 0 !important; width: auto; }
                table.simple-table input { width: 100%; border: none; padding: 4px 8px; text-align: right !important; box-sizing: border-box; background-color: var(--input-bg); }
                table.simple-table td.calc-cell { background-color: var(--calc-bg); text-align: right; padding: 4px 8px !important; }

                table.data-table { table-layout: fixed !important; min-width: 800px !important; }
                table.data-table th { white-space: normal; word-wrap: break-word; line-height: 1.2; padding: 4px !important; }
                
                .col-action { width: 30px; text-align: center; }
                .col-num { width: 55px; text-align: center; } 
                .col-tot { width: 85px; text-align: right; } 
                
                table.data-table td.input-cell { padding-left: 2px !important; padding-right: 2px !important; }
                table.data-table input, table.data-table select { width: 100%; box-sizing: border-box; background-color: var(--input-bg); border: 1px solid #ccc; padding: 3px; }
                table.data-table input[type="number"] { text-align: right; }
                table.data-table td.calc-cell { background-color: var(--calc-bg); padding-right: 6px !important; text-align: right; overflow: hidden; text-overflow: ellipsis; }

                input[type="number"]::-webkit-outer-spin-button,
                input[type="number"]::-webkit-inner-spin-button { -webkit-appearance: none; margin: 0; }
                input[type="number"] { -moz-appearance: textfield; }
                
                .total-row td { font-weight: bold; background-color: var(--accent-bg); border-top: 2px solid var(--header-bg); }
                .subtotal-row td { background-color: #E8F0FE !important; font-style: italic; border-top: 1px dashed #1F4E78 !important; }
                
                .toolbar { display: flex; gap: 10px; margin-bottom: 15px; background: #e9ecef; padding: 8px 10px; border-radius: 5px; flex-wrap: wrap; align-items: center; }
                .btn-add { background-color: var(--btn-bg); color: white; border: none; padding: 2px 8px; cursor: pointer; border-radius: 3px; font-weight:bold; }
                .btn-del { background-color: var(--btn-del); color: white; border: none; padding: 2px 8px; cursor: pointer; border-radius: 3px; font-weight:bold; }
                
                #lock-overlay { position: absolute; top: 0; left: 0; width: 100%; height: 100%; background: rgba(255,255,255,0.9); z-index: 1000; display: flex; align-items: center; justify-content: center; backdrop-filter: blur(5px); }
                .lock-modal { background: #f8f9fa; border: 2px solid var(--header-bg); padding: 2rem; border-radius: 8px; box-shadow: 0 10px 25px rgba(0,0,0,0.2); width: 400px; }
                .lock-modal input { width: 100%; padding: 0.5rem; margin-bottom: 1rem; border: 1px solid #ccc; border-radius: 4px; box-sizing: border-box; }

                .qbo-badge { background: #e8f8f5; color: #27ae60; font-size: 0.7rem; padding: 2px 5px; border-radius: 3px; font-weight: bold; margin-left: 5px; white-space: nowrap; }

                @media (max-width: 1024px) { .left-column, .right-column { flex: 1 1 100%; } }
                @media (max-width: 768px) {
                    .data-table th:nth-child(1), .data-table td:nth-child(1),
                    .data-table th:nth-child(2), .data-table td:nth-child(2) { position: sticky; z-index: 2; background-color: #fff; }
                    .data-table th:nth-child(1), .data-table th:nth-child(2) { background-color: var(--header-bg); z-index: 3; }
                    .data-table th:nth-child(1), .data-table td:nth-child(1) { left: 0; }
                    .data-table th:nth-child(2), .data-table td:nth-child(2) { left: 30px; box-shadow: 2px 0 5px -2px rgba(0,0,0,0.2); }
                }
            </style>

            <div class="container" style="padding-top: 0.25rem;">
                <h2 style="margin-top: 0; margin-bottom: 0.25rem; font-size: 1.4rem;">VillSync to QB: Product Cost Builder</h2>
                <div id="alertBox" class="alert" style="margin-bottom: 0.25rem; padding: 0.4rem;"></div>

                <div class="costing-dashboard" style="position: relative; min-height: 600px;">
                    <div id="lock-overlay">
                        <div class="lock-modal">
                            <h3 style="margin-top:0; color:var(--header-bg);">Initialize Production Batch</h3>
                            <label><strong>Batch ID</strong></label>
                            <input type="text" id="initBatchId" value="${this.batchData.batchId}" readonly style="background:#e9ecef;">
                            <label><strong>Client Name</strong></label>
                            <input type="text" id="initClientName" placeholder="E.g. Acme Corp">
                            <label><strong>Product Variant Name</strong></label>
                            <input type="text" id="initProductName" placeholder="E.g. Strawberry 10mg">
                            <button class="btn" id="unlockBtn" style="width: 100%; margin-bottom: 1rem;">Generate Batch Workspace</button>
                            
                            <div style="text-align: center; color: #888; margin-bottom: 1rem; font-size: 0.85rem; font-weight: bold;">— OR —</div>
                            
                            <label class="btn outline" style="display: block; text-align: center; margin: 0; background: white; color: #2c3e50; border: 1px dashed #2c3e50; cursor: pointer; padding: 0.6rem;">
                                📂 Load Existing JSON Batch <input type="file" id="modalLoadJsonInput" accept=".json" style="display:none;">
                            </label>
                        </div>
                    </div>

                    <h2 id="dashboard-title-display" style="font-size: 18px; border-bottom: 3px solid var(--header-bg); padding-bottom: 5px; margin-top:0;">[AWAITING INITIALIZATION]</h2>

                    <div class="toolbar">
                        <button class="btn" id="saveJsonBtn" style="padding: 6px 12px;">💾 Save to JSON</button>
                        <label class="btn outline" style="margin: 0; padding: 6px 12px; background: white; color: #2c3e50; border: 1px solid #2c3e50; cursor: pointer;">
                            📂 Load JSON <input type="file" id="loadJsonInput" accept=".json" style="display:none;">
                        </label>
                        <button class="btn" id="exportExcelBtn" style="background-color: #207245; padding: 6px 12px;">📊 Export to Excel</button>
                    </div>

                    <div class="main-layout">
                        <div class="left-column">
                            <div>
                                <h2>1. Batch Production Parameters</h2>
                                <div class="table-responsive">
                                    <table class="costing-table simple-table" id="params-table">
                                        <tr><td class="label-cell">Input Target Volume (Liters)</td><td><input type="number" id="p_vol" class="calc-trigger" value="50.00"></td></tr>
                                        <tr><td class="label-cell">Alcohol Evaporation Rate (%)</td><td><input type="number" id="p_evap" class="calc-trigger" value="8"></td></tr>
                                        <tr><td class="label-cell">Molding Scrap/Rejection Rate (%)</td><td><input type="number" id="p_scrap" class="calc-trigger" value="4"></td></tr>
                                        <tr><td class="label-cell">Expected Gummies per Liter</td><td><input type="number" id="p_gpl" class="calc-trigger" value="250"></td></tr>
                                        <tr><td class="label-cell">Gummies per Pack</td><td><input type="number" id="p_gpp" class="calc-trigger" value="10"></td></tr>
                                    </table>
                                </div>
                            </div>

                            <div>
                                <h2>2. Direct Materials (BOM)</h2>
                                <div class="table-responsive">
                                    <table class="costing-table data-table" id="bom-table">
                                        <thead>
                                            <tr>
                                                <th class="col-action"><button class="btn-add" id="addBomBtn">+</button></th>
                                                <th>Raw Material Ingredient</th>
                                                <th class="col-num">Qty</th>
                                                <th class="col-num">Cost/Unit</th>
                                                <th class="col-tot">Total Batch Material Cost</th>
                                                <th class="col-num">% Comp</th>
                                                <th class="col-tot dynamic-cost-header">WIP Cost</th>
                                            </tr>
                                        </thead>
                                        <tbody id="bom-tbody"></tbody>
                                        <tfoot id="bom-tfoot">
                                            <tr class="total-row">
                                                <td colspan="4" style="text-align: right; padding-right:10px;">TOTAL RAW MATERIAL COST:</td>
                                                <td class="col-tot calc-cell" id="bom_cost_total">$0.00</td>
                                                <td></td>
                                                <td class="col-tot calc-cell" id="bom_wip_total">$0.00</td>
                                            </tr>
                                        </tfoot>
                                    </table>
                                </div>
                            </div>

                            <div>
                                <h2>3. Labor Burden Calculator</h2>
                                <div class="table-responsive">
                                    <table class="costing-table data-table" id="labor-table">
                                        <thead>
                                            <tr>
                                                <th class="col-action"><button class="btn-add" id="addLaborBtn">+</button></th>
                                                <th>Production Stage</th>
                                                <th>Employee Function</th>
                                                <th class="col-tot">Total Est.<br>Labor Cost</th>
                                                <th class="col-num">Total Est.<br>Labor Hrs</th>
                                                <th class="col-num">Labor Rate<br>(Per Hr)</th>
                                                <th class="col-num">Batch Hrs</th>
                                                <th class="col-tot">Total Batch<br>Labor Cost</th>
                                                <th class="col-num">% Comp</th>
                                                <th class="col-tot dynamic-cost-header">WIP Cost</th>
                                            </tr>
                                        </thead>
                                        <tfoot id="labor-tfoot">
                                            <tr class="total-row">
                                                <td colspan="7" style="text-align: right; padding-right:10px;">TOTAL BATCH LABOR COST:</td>
                                                <td class="col-tot calc-cell" id="labor_cost_total">$0.00</td>
                                                <td></td>
                                                <td class="col-tot calc-cell" id="labor_wip_total">$0.00</td>
                                            </tr>
                                        </tfoot>
                                    </table>
                                </div>
                            </div>

                            <div>
                                <h2>4. Straight Overhead Calculator</h2>
                                <div class="table-responsive">
                                    <table class="costing-table data-table" id="overhead-table">
                                        <thead>
                                            <tr>
                                                <th class="col-action"><button class="btn-add" id="addOhBtn">+</button></th>
                                                <th>Production Stage</th>
                                                <th>Overhead Cost Label</th>
                                                <th class="col-tot">Total Est.<br>O.H. Cost</th>
                                                <th class="col-num">Total Est.<br>Driver Hrs</th>
                                                <th class="col-num">O.H. Rate<br>(Per Hr)</th>
                                                <th class="col-num">Batch Hrs</th>
                                                <th class="col-tot">Total Batch<br>O.H. Cost</th>
                                                <th class="col-num">% Comp</th>
                                                <th class="col-tot dynamic-cost-header">WIP Cost</th>
                                            </tr>
                                        </thead>
                                        <tfoot id="oh-tfoot">
                                            <tr class="total-row">
                                                <td colspan="7" style="text-align: right; padding-right:10px;">TOTAL BATCH O.H. COST:</td>
                                                <td class="col-tot calc-cell" id="oh_cost_total">$0.00</td>
                                                <td></td>
                                                <td class="col-tot calc-cell" id="oh_wip_total">$0.00</td>
                                            </tr>
                                        </tfoot>
                                    </table>
                                </div>
                            </div>
                        </div>

                        <div class="right-column">
                            <div>
                                <h2>5. Process Yield & Unit Cost Summary</h2>
                                <div class="table-responsive">
                                    <table class="costing-table simple-table" id="yield-table">
                                        <tr><td class="label-cell">Starting Volume (Liters)</td><td class="calc-cell" id="y_start">0.00</td></tr>
                                        <tr><td class="label-cell">Less: Evaporation Loss</td><td class="calc-cell" id="y_evap">0.00</td></tr>
                                        <tr><td class="label-cell">Less: Molding Scrap</td><td class="calc-cell" id="y_scrap">0.00</td></tr>
                                        <tr><td class="label-cell" style="font-weight: bold;">Net Finished Volume (Liters)</td><td class="calc-cell" id="y_net" style="font-weight: bold;">0.00</td></tr>
                                        <tr><td class="label-cell" style="font-weight: bold;">Total Gross Gummies Produced</td><td class="calc-cell" id="y_gummies" style="font-weight: bold;">0</td></tr>
                                        <tr><td colspan="2" style="border: none; padding: 5px;"></td></tr>
                                        <tr class="total-row"><td class="label-cell">TOTAL BATCH COST</td><td class="calc-cell" id="s_batch_cost">$0.00</td></tr>
                                        <tr><td class="label-cell">COST PER FINISHED GUMMY</td><td class="calc-cell" id="s_cpg" style="font-weight: bold;">$0.00</td></tr>
                                        <tr><td colspan="2" style="border: none; padding: 5px;"></td></tr>
                                        <tr><td class="label-cell">Total Cost of Gummies per Pack</td><td class="calc-cell" id="s_cost_per_pack_gummies">$0.00</td></tr>
                                        <tr><td class="label-cell">Add: Packaging Cost per Pack <span style="float:right; margin-right:5px; color:#666;">$</span></td><td><input type="number" id="p_pack_cost" class="calc-trigger" value="0.18"></td></tr>
                                        <tr class="total-row"><td class="label-cell">TOTAL COST PER PACK / BAG</td><td class="calc-cell" id="s_total_pack_cost" style="font-weight: bold;">$0.00</td></tr>
                                    </table>
                                </div>
                            </div>
                            
                            <div>
                                <h2>6. Pricing & Margin Analysis</h2>
                                <div class="table-responsive">
                                    <table class="costing-table simple-table" id="pricing-table">
                                        <tr><td class="label-cell">Target Profit Margin (%)</td><td><input type="number" id="p_margin" class="calc-trigger" value="65"></td></tr>
                                        <tr class="total-row"><td class="label-cell">Recommended Wholesale Price (Per Pack)</td><td class="calc-cell" id="p_wholesale">$0.00</td></tr>
                                    </table>
                                </div>
                            </div>
                        </div>
                    </div>

                    <div style="margin-top: 2rem;">
                        <div id="pushStatusBar" style="background: #f8f9fa; border: 1px solid #dee2e6; border-left: 4px solid #27ae60; padding: 0.4rem 1rem; margin-bottom: 0.5rem; border-radius: 4px; display: flex; justify-content: space-between; align-items: center; font-size: 0.9rem; flex-wrap: wrap; gap: 10px;">
                            <span id="pushStatusText" style="font-weight: 500; color: #2c3e50;">Loading user profile...</span>
                            <span id="limitText" style="color: #666; font-weight: bold; margin-left: auto;"></span>
                        </div>
                    
                        <div class="tabs main-tabs" style="border-bottom: 2px solid #27ae60; margin-bottom: 0; display:flex; align-items: center; flex-wrap: wrap;">
                            <button class="tab active" data-maintab="general_journal">General Journal</button>
                            <button class="tab" data-maintab="adjustment_entry">Inventory Adjustment</button>
                            <button class="tab" data-maintab="mapping" style="color: #e74c3c;">Mapping</button>
                            
                            <button class="btn" id="pushQboBtn" style="background-color: #27ae60; color: white; margin-left: auto; padding: 6px 16px; margin-bottom: 4px; border: none; border-radius: 4px; font-weight: bold; cursor: pointer;" disabled>☁️ Push Entry to QBO</button>
                        </div>
                        <div id="costingTabContent" style="background:#f8f9fa; border:1px solid #dee2e6; border-top:none; padding:1rem;">
                            </div>
                    </div>
                </div>
            </div>

            <div id="mappingHistoryModal" class="modal-overlay" style="display:none; position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.5); z-index:2000; align-items:center; justify-content:center;">
                <div class="modal-content" style="background:#fff; padding:2rem; border-radius:8px; width:90%; max-width:800px;">
                    <h2 style="margin-top:0;">Audit History: <span id="historyLineItemLabel" style="color: #27ae60;"></span></h2>
                    <div id="mappingHistoryTableContainer" style="margin: 1rem 0; max-height: 400px; overflow-y: auto;"></div>
                    <div style="text-align: right; margin-top: 1rem;">
                        <button class="btn outline" onclick="document.getElementById('mappingHistoryModal').style.display='none'">Close</button>
                    </div>
                </div>
            </div>
        `;
    }

    async afterRender() {
        if (!currentUser) return;
        
        await this.checkUserRole();

        document.getElementById('unlockBtn').addEventListener('click', () => {
            const cName = document.getElementById('initClientName').value.trim();
            const pName = document.getElementById('initProductName').value.trim();
            if (!cName || !pName) return this.showAlert("Client Name and Product Name are required.", "danger");
            
            this.batchData.clientName = cName;
            this.batchData.productName = pName;
            document.getElementById('dashboard-title-display').innerText = `${cName} - ${pName}_${this.batchData.batchId}`;
            document.getElementById('lock-overlay').style.display = 'none';
            this.calculateAll();
        });

        document.getElementById('modalLoadJsonInput').addEventListener('change', (e) => this.loadFromJson(e));
        document.getElementById('loadJsonInput').addEventListener('change', (e) => this.loadFromJson(e));
        
        document.getElementById('saveJsonBtn').addEventListener('click', () => this.saveToJson());
        document.getElementById('exportExcelBtn').addEventListener('click', () => this.exportToExcel());
        document.getElementById('pushQboBtn').addEventListener('click', () => this.handlePushToQbo());

        const qboSelect = document.getElementById('qboSelect');
        if (qboSelect) {
            qboSelect.addEventListener('change', async () => {
                await this.loadLiveQboData();
                this.calculateAll();
            });
        }
        
        await this.loadLiveQboData();
        await this.loadDropdownCollections();

        this.attachGlobalHelpers();

        document.getElementById('addBomBtn').addEventListener('click', () => this.addBomRow());
        document.getElementById('addLaborBtn').addEventListener('click', () => this.addLaborStageGroup());
        document.getElementById('addOhBtn').addEventListener('click', () => this.addOhStageGroup());

        document.querySelectorAll('.calc-trigger').forEach(el => el.addEventListener('input', () => this.calculateAll()));

        document.querySelectorAll('.main-tabs .tab').forEach(tab => {
            tab.addEventListener('click', (e) => {
                document.querySelectorAll('.main-tabs .tab').forEach(t => t.classList.remove('active'));
                e.target.classList.add('active');
                this.activeMainTab = e.target.dataset.maintab;
                this.renderActiveTab();
            });
        });

        this.addBomRow();
        this.addLaborStageGroup();
        this.addOhStageGroup();
    }

    async checkUserRole() {
        this.userRole = 'guest'; 
        if (currentUser.email === 'vnvcpas.excelimporter@gmail.com') {
            this.userRole = 'super_admin';
        } else {
            try {
                const adminDoc = await getDoc(doc(db, "global_config", "admins"));
                if (adminDoc.exists() && adminDoc.data()[currentUser.email]) {
                    this.userRole = 'admin';
                }
            } catch (e) {}
        }
        
        const pushBtn = document.getElementById('pushQboBtn');
        const limitText = document.getElementById('limitText');
        const statusText = document.getElementById('pushStatusText');

        if (this.userRole !== 'guest') {
            if(pushBtn) {
                pushBtn.disabled = false;
                pushBtn.title = "Push these entries to QBO";
            }
            if(limitText) limitText.innerHTML = `<span style="color:#27ae60;">Admin | Unlimited Push</span>`;
            if(statusText) statusText.innerText = "Workspace ready. Entries can be pushed to QBO.";
        } else {
            if(pushBtn) {
                pushBtn.disabled = true;
                pushBtn.title = "Available to Subscribers/Admins only";
            }
            if(limitText) limitText.innerHTML = `<span style="color:#e74c3c;">Guest | Cannot push items or product build entry to QBO</span>`;
            if(statusText) statusText.innerText = "Only admin users are allowed to save items or push transactions in this tool.";
        }
    }

    async loadDropdownCollections() {
        try {
            const fetchCol = async (colName) => {
                const snap = await getDocs(collection(db, colName));
                let arr = [];
                snap.forEach(doc => arr.push(doc.id));
                return arr;
            };
            this.rawMaterials = await fetchCol('rawMaterials');
            this.productionStages = await fetchCol('productionStages');
            this.laborItems = await fetchCol('laborItems');
            this.overheadItems = await fetchCol('overheadItems');
        } catch (e) {
            console.error("Failed to load dropdown collections", e);
        }
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
            this.showAlert("Could not sync with QBO. Mappings may be inaccurate.", "warning");
        }
    }

    generateSelectHtml(options, className, onchangeStr, selectedVal = "") {
        let html = `<select class="${className}" onchange="if(this.value==='ADD_NEW'){window.addNewDropdownItem(this, '${className}')} else {${onchangeStr}}">`;
        html += `<option value="">Select...</option>`;
        html += `<option value="ADD_NEW" style="font-weight:bold; color:var(--btn-bg);">+ Add New Item</option>`;
        options.forEach(opt => {
            const isSelected = (opt === selectedVal) ? 'selected' : '';
            html += `<option value="${opt}" ${isSelected}>${opt}</option>`;
        });
        html += `</select>`;
        return html;
    }

    attachGlobalHelpers() {
        window.addNewDropdownItem = async (selectEl, className) => {
            const newVal = prompt("Enter the name of the new item:");
            if (!newVal || newVal.trim() === "") { selectEl.value = ""; return; }
            
            let colName = "";
            if (className.includes('b-item')) colName = "rawMaterials";
            if (className.includes('stage')) colName = "productionStages";
            if (className.includes('l-func')) colName = "laborItems";
            if (className.includes('o-label')) colName = "overheadItems";

            try {
                const addCostingDropdownItem = httpsCallable(functions, 'addCostingDropdownItem');
                await addCostingDropdownItem({ collectionName: colName, itemName: newVal.trim() });
                
                if (colName === "rawMaterials") this.rawMaterials.push(newVal.trim());
                if (colName === "productionStages") this.productionStages.push(newVal.trim());
                if (colName === "laborItems") this.laborItems.push(newVal.trim());
                if (colName === "overheadItems") this.overheadItems.push(newVal.trim());
                
                this.showAlert(`${newVal} added successfully!`, "success");
                const opt = document.createElement('option');
                opt.value = newVal.trim();
                opt.innerText = newVal.trim();
                selectEl.appendChild(opt);
                selectEl.value = newVal.trim();
                this.calculateAll();

            } catch (e) {
                this.showAlert(`Failed to add new item. ${e.message}`, "danger");
                selectEl.value = "";
            }
        };

        window.addLaborSubRow = (stageId) => {
            const tbody = document.querySelector(`.labor-group[data-id="${stageId}"]`);
            const tr = document.createElement('tr');
            tr.className = 'labor-sub-row line-row';
            tr.innerHTML = `
                <td class="col-action"><button class="btn-del" onclick="window.deleteSubRow(this)">-</button></td>
                <td class="input-cell"></td>
                <td class="input-cell">${this.generateSelectHtml(this.laborItems, 'l-func', 'window.calcTrigger()')}</td>
                <td class="col-tot input-cell"><input type="number" class="l-mcost calc-trigger" value="0"></td>
                <td class="col-num input-cell"><input type="number" class="l-mhrs calc-trigger" value="160"></td>
                <td class="col-num calc-cell l-rate">0.00</td>
                <td class="col-num input-cell"><input type="number" class="l-bhrs calc-trigger" value="0"></td>
                <td class="col-tot calc-cell l-total">0.00</td>
                <td class="col-num input-cell"><input type="number" class="l-comp calc-trigger" value="100" max="100" min="0"></td>
                <td class="col-tot calc-cell l-wip">0.00</td>
            `;
            tbody.insertBefore(tr, tbody.querySelector('.subtotal-row'));
            this.calculateAll();
        };

        window.addOhSubRow = (stageId) => {
            const tbody = document.querySelector(`.oh-group[data-id="${stageId}"]`);
            const tr = document.createElement('tr');
            tr.className = 'oh-sub-row line-row';
            tr.innerHTML = `
                <td class="col-action"><button class="btn-del" onclick="window.deleteSubRow(this)">-</button></td>
                <td class="input-cell"></td>
                <td class="input-cell">${this.generateSelectHtml(this.overheadItems, 'o-label', 'window.calcTrigger()')}</td>
                <td class="col-tot input-cell"><input type="number" class="o-mcost calc-trigger" value="0"></td>
                <td class="col-num input-cell"><input type="number" class="o-mhrs calc-trigger" value="160"></td>
                <td class="col-num calc-cell o-rate">0.00</td>
                <td class="col-num input-cell"><input type="number" class="o-bhrs calc-trigger" value="0"></td>
                <td class="col-tot calc-cell l-total">0.00</td>
                <td class="col-num input-cell"><input type="number" class="o-comp calc-trigger" value="100" max="100" min="0"></td>
                <td class="col-tot calc-cell o-wip">0.00</td>
            `;
            tbody.insertBefore(tr, tbody.querySelector('.subtotal-row'));
            this.calculateAll();
        };

        window.deleteSubRow = (btn) => {
            btn.closest('tr').remove();
            this.calculateAll();
        };
    }

    addBomRow(item = "", qty = "0", cost = "0", comp = "100") {
        const tr = document.createElement('tr');
        tr.className = 'bom-row line-row';
        tr.innerHTML = `
            <td class="col-action"><button class="btn-del" onclick="this.closest('tr').remove(); window.calcTrigger()">-</button></td>
            <td class="input-cell">${this.generateSelectHtml(this.rawMaterials, 'b-item', 'window.calcTrigger()', item)}</td>
            <td class="col-num input-cell"><input type="number" class="b-qty calc-trigger" value="${qty}"></td>
            <td class="col-num input-cell"><input type="number" class="b-cost calc-trigger" value="${cost}"></td>
            <td class="col-tot calc-cell b-total">0.00</td>
            <td class="col-num input-cell"><input type="number" class="b-comp calc-trigger" value="${comp}" max="100" min="0"></td>
            <td class="col-tot calc-cell b-wip">0.00</td>
        `;
        document.getElementById('bom-tbody').appendChild(tr);
    }

    addLaborStageGroup(stageName = "Mixing and Cooking", rowsData = [{func:"", mcost:"0", mhrs:"160", bhrs:"0", comp:"100"}]) {
        const stageId = 'L_' + Math.random().toString(36).substr(2, 9);
        const tbody = document.createElement('tbody');
        tbody.className = 'labor-group';
        tbody.setAttribute('data-id', stageId);

        rowsData.forEach((rData, index) => {
            const tr = document.createElement('tr');
            tr.className = index === 0 ? 'labor-main-row line-row' : 'labor-sub-row line-row';
            let btnHtml = index === 0 ? `<button class="btn-add" onclick="window.addLaborSubRow('${stageId}')">+</button>` : `<button class="btn-del" onclick="window.deleteSubRow(this)">-</button>`;
            let stageHtml = index === 0 ? this.generateSelectHtml(this.productionStages, 'l-stage', 'window.calcTrigger()', stageName) : ``;

            tr.innerHTML = `
                <td class="col-action">${btnHtml}</td>
                <td class="input-cell">${stageHtml}</td>
                <td class="input-cell">${this.generateSelectHtml(this.laborItems, 'l-func', 'window.calcTrigger()', rData.func)}</td>
                <td class="col-tot input-cell"><input type="number" class="l-mcost calc-trigger" value="${rData.mcost}"></td>
                <td class="col-num input-cell"><input type="number" class="l-mhrs calc-trigger" value="${rData.mhrs}"></td>
                <td class="col-num calc-cell l-rate">0.00</td>
                <td class="col-num input-cell"><input type="number" class="l-bhrs calc-trigger" value="${rData.bhrs}"></td>
                <td class="col-tot calc-cell l-total">0.00</td>
                <td class="col-num input-cell"><input type="number" class="l-comp calc-trigger" value="${rData.comp}" max="100" min="0"></td>
                <td class="col-tot calc-cell l-wip">0.00</td>
            `;
            tbody.appendChild(tr);
        });

        const subTr = document.createElement('tr');
        subTr.className = 'subtotal-row';
        subTr.innerHTML = `<td colspan="7" style="text-align: right; padding-right:10px;" class="subtotal-label">Total Stage Cost:</td><td class="col-tot calc-cell l-subtotal-val" style="font-weight:bold;">0.00</td><td colspan="2"></td>`;
        tbody.appendChild(subTr);
        document.getElementById('labor-table').insertBefore(tbody, document.getElementById('labor-tfoot'));
    }

    addOhStageGroup(stageName = "Mixing and Cooking", rowsData = [{label:"", mcost:"0", mhrs:"160", bhrs:"0", comp:"100"}]) {
        const stageId = 'O_' + Math.random().toString(36).substr(2, 9);
        const tbody = document.createElement('tbody');
        tbody.className = 'oh-group';
        tbody.setAttribute('data-id', stageId);

        rowsData.forEach((rData, index) => {
            const tr = document.createElement('tr');
            tr.className = index === 0 ? 'oh-main-row line-row' : 'oh-sub-row line-row';
            let btnHtml = index === 0 ? `<button class="btn-add" onclick="window.addOhSubRow('${stageId}')">+</button>` : `<button class="btn-del" onclick="window.deleteSubRow(this)">-</button>`;
            let stageHtml = index === 0 ? this.generateSelectHtml(this.productionStages, 'o-stage', 'window.calcTrigger()', stageName) : ``;

            tr.innerHTML = `
                <td class="col-action">${btnHtml}</td>
                <td class="input-cell">${stageHtml}</td>
                <td class="input-cell">${this.generateSelectHtml(this.overheadItems, 'o-label', 'window.calcTrigger()', rData.label)}</td>
                <td class="col-tot input-cell"><input type="number" class="o-mcost calc-trigger" value="${rData.mcost}"></td>
                <td class="col-num input-cell"><input type="number" class="o-mhrs calc-trigger" value="${rData.mhrs}"></td>
                <td class="col-num calc-cell o-rate">0.00</td>
                <td class="col-num input-cell"><input type="number" class="o-bhrs calc-trigger" value="${rData.bhrs}"></td>
                <td class="col-tot calc-cell o-total">0.00</td>
                <td class="col-num input-cell"><input type="number" class="o-comp calc-trigger" value="${rData.comp}" max="100" min="0"></td>
                <td class="col-tot calc-cell o-wip">0.00</td>
            `;
            tbody.appendChild(tr);
        });

        const subTr = document.createElement('tr');
        subTr.className = 'subtotal-row';
        subTr.innerHTML = `<td colspan="7" style="text-align: right; padding-right:10px;" class="subtotal-label">Total Stage Cost:</td><td class="col-tot calc-cell o-subtotal-val" style="font-weight:bold;">0.00</td><td colspan="2"></td>`;
        tbody.appendChild(subTr);
        document.getElementById('overhead-table').insertBefore(tbody, document.getElementById('oh-tfoot'));
    }

    attachTriggers() {
        window.calcTrigger = () => this.calculateAll();
        document.querySelectorAll('.calc-trigger').forEach(el => {
            el.removeEventListener('input', window.calcTrigger);
            el.addEventListener('input', window.calcTrigger);
        });
    }

    calculateAll() {
        const vol = parseFloat(document.getElementById('p_vol').value) || 0;
        const evapRate = (parseFloat(document.getElementById('p_evap').value) || 0) / 100;
        const scrapRate = (parseFloat(document.getElementById('p_scrap').value) || 0) / 100;
        const gpl = parseFloat(document.getElementById('p_gpl').value) || 0;
        const gpp = parseFloat(document.getElementById('p_gpp').value) || 1;

        const evapLoss = vol * evapRate;
        const remainingAfterEvap = vol - evapLoss;
        const scrapLoss = remainingAfterEvap * scrapRate;
        const netVol = remainingAfterEvap - scrapLoss;
        const grossGummies = netVol * gpl;

        document.getElementById('y_start').innerText = vol.toFixed(2);
        document.getElementById('y_evap').innerText = evapLoss.toFixed(2);
        document.getElementById('y_scrap').innerText = scrapLoss.toFixed(2);
        document.getElementById('y_net').innerText = netVol.toFixed(2);
        document.getElementById('y_gummies').innerText = Math.round(grossGummies).toLocaleString();

        let allComplete = true;
        document.querySelectorAll('.b-comp, .l-comp, .o-comp').forEach(input => {
            if ((parseFloat(input.value) || 0) < 100) allComplete = false;
        });
        this.batchData.isComplete = allComplete;
        
        const dynamicHeader = allComplete ? "FG Cost" : "WIP Cost";
        document.querySelectorAll('.dynamic-cost-header').forEach(th => th.innerText = dynamicHeader);

        this.uniqueLineItems.clear();
        this.uniqueLineItems.add(`FGD - ${this.batchData.productName}`);

        let bomTot = 0, bomWipTot = 0;
        document.querySelectorAll('.bom-row').forEach(row => {
            let q = parseFloat(row.querySelector('.b-qty').value) || 0;
            let c = parseFloat(row.querySelector('.b-cost').value) || 0;
            let comp = (parseFloat(row.querySelector('.b-comp').value) || 0) / 100;
            let item = row.querySelector('.b-item').value;
            if(item && item !== "ADD_NEW") this.uniqueLineItems.add(`RAW - ${item}`);
            
            let tot = q * c;
            let wip = tot * comp;
            bomTot += tot; bomWipTot += wip;
            row.querySelector('.b-total').innerText = tot.toFixed(2);
            row.querySelector('.b-wip').innerText = wip.toFixed(2);
        });
        document.getElementById('bom_cost_total').innerText = bomTot.toFixed(2);
        document.getElementById('bom_wip_total').innerText = bomWipTot.toFixed(2);

        let labTot = 0, labWipTot = 0;
        document.querySelectorAll('.labor-group').forEach(group => {
            let sTotal = 0;
            let stageEl = group.querySelector('.l-stage');
            let stage = stageEl ? stageEl.value : 'Stage';
            
            group.querySelectorAll('.labor-main-row, .labor-sub-row').forEach(row => {
                let mCost = parseFloat(row.querySelector('.l-mcost').value) || 0;
                let mHrs = parseFloat(row.querySelector('.l-mhrs').value) || 1;
                let r = mHrs > 0 ? mCost / mHrs : 0;
                row.querySelector('.l-rate').innerText = r.toFixed(2);
                
                let h = parseFloat(row.querySelector('.l-bhrs').value) || 0;
                let comp = (parseFloat(row.querySelector('.l-comp').value) || 0) / 100;
                let func = row.querySelector('.l-func').value;
                if(stage && func && stage !== "ADD_NEW" && func !== "ADD_NEW") this.uniqueLineItems.add(`LBR - ${stage} - ${func}`);

                let tot = r * h;
                let wip = tot * comp;
                sTotal += tot; labTot += tot; labWipTot += wip;
                row.querySelector('.l-total').innerText = tot.toFixed(2);
                row.querySelector('.l-wip').innerText = wip.toFixed(2);
            });
            
            const subRow = group.querySelector('.subtotal-row');
            if(group.querySelectorAll('tr').length > 2) {
                subRow.style.display = 'table-row';
                subRow.querySelector('.subtotal-label').innerText = `Total ${stage || 'Stage'} Cost:`;
                subRow.querySelector('.l-subtotal-val').innerText = sTotal.toFixed(2);
            } else { subRow.style.display = 'none'; }
        });
        document.getElementById('labor_cost_total').innerText = labTot.toFixed(2);
        document.getElementById('labor_wip_total').innerText = labWipTot.toFixed(2);

        let ohTot = 0, ohWipTot = 0;
        document.querySelectorAll('.oh-group').forEach(group => {
            let sTotal = 0;
            let stageEl = group.querySelector('.o-stage');
            let stage = stageEl ? stageEl.value : 'Stage';
            
            group.querySelectorAll('.oh-main-row, .oh-sub-row').forEach(row => {
                let mCost = parseFloat(row.querySelector('.o-mcost').value) || 0;
                let mHrs = parseFloat(row.querySelector('.o-mhrs').value) || 1;
                let r = mHrs > 0 ? mCost / mHrs : 0;
                row.querySelector('.o-rate').innerText = r.toFixed(2);
                
                let h = parseFloat(row.querySelector('.o-bhrs').value) || 0;
                let comp = (parseFloat(row.querySelector('.o-comp').value) || 0) / 100;
                let label = row.querySelector('.o-label').value;
                if(stage && label && stage !== "ADD_NEW" && label !== "ADD_NEW") this.uniqueLineItems.add(`FOH - ${stage} - ${label}`);

                let tot = r * h;
                let wip = tot * comp;
                sTotal += tot; ohTot += tot; ohWipTot += wip;
                row.querySelector('.o-total').innerText = tot.toFixed(2);
                row.querySelector('.o-wip').innerText = wip.toFixed(2);
            });
            
            const subRow = group.querySelector('.subtotal-row');
            if(group.querySelectorAll('tr').length > 2) {
                subRow.style.display = 'table-row';
                subRow.querySelector('.subtotal-label').innerText = `Total ${stage || 'Stage'} Cost:`;
                subRow.querySelector('.o-subtotal-val').innerText = sTotal.toFixed(2);
            } else { subRow.style.display = 'none'; }
        });
        document.getElementById('oh_cost_total').innerText = ohTot.toFixed(2);
        document.getElementById('oh_wip_total').innerText = ohWipTot.toFixed(2);

        let batchCost = bomTot + labTot + ohTot; 
        document.getElementById('s_batch_cost').innerText = batchCost.toFixed(2);
        let costPerGummy = grossGummies > 0 ? (batchCost / grossGummies) : 0;
        document.getElementById('s_cpg').innerText = costPerGummy.toFixed(2);

        let costOfGummiesPerPack = costPerGummy * gpp;
        document.getElementById('s_cost_per_pack_gummies').innerText = costOfGummiesPerPack.toFixed(2);
        let packCost = parseFloat(document.getElementById('p_pack_cost').value) || 0;
        let totalCostPerPack = costOfGummiesPerPack + packCost;
        document.getElementById('s_total_pack_cost').innerText = totalCostPerPack.toFixed(2);

        let margin = (parseFloat(document.getElementById('p_margin').value) || 0) / 100;
        let wholesale = margin < 1 ? (totalCostPerPack / (1 - margin)) : 0;
        document.getElementById('p_wholesale').innerText = wholesale.toFixed(2);

        if(document.getElementById('costingTabContent').innerHTML.trim() !== "") {
            this.renderActiveTab();
        }
    }

    renderActiveTab() {
        if (this.activeMainTab === 'general_journal') this.renderJournalTab();
        else if (this.activeMainTab === 'adjustment_entry') this.renderAdjustmentTab();
        else if (this.activeMainTab === 'mapping') this.renderMappingTable();
    }

    renderJournalTab() {
        let html = `
            <div style="margin-bottom: 10px;">
                <label style="font-weight:bold;">Entry Date:</label>
                <input type="date" id="journalDate" style="padding:4px; margin-left:10px;">
            </div>
            <div class="table-responsive">
            <table class="costing-table data-table" style="width:100% !important; min-width: 600px !important;">
                <thead><tr>
                    <th style="text-align:left; width: auto;">Account</th>
                    <th class="col-tot">Debit</th>
                    <th class="col-tot">Credit</th>
                    <th style="text-align:left; width: auto;">Memo</th>
                </tr></thead>
                <tbody>
        `;

        let totalWipCost = 0;
        const creditLines = [];

        document.querySelectorAll('.bom-row').forEach(r => {
            const w = parseFloat(r.querySelector('.b-wip').innerText) || 0;
            const item = r.querySelector('.b-item').value;
            if (w > 0 && item && item !== "ADD_NEW") {
                totalWipCost += w;
                const match = this.qboAccounts.find(a => a.name.toLowerCase() === `RAW - ${item}`.toLowerCase());
                const cat = match ? match.name : '<span style="color:red">Unmapped</span>';
                creditLines.push(`<tr><td>${cat}</td><td></td><td class="col-tot calc-cell">${w.toFixed(2)}</td><td>Raw Mat: ${item}</td></tr>`);
            }
        });
        document.querySelectorAll('.labor-group').forEach(g => {
            const stage = g.querySelector('.l-stage').value;
            g.querySelectorAll('.labor-main-row, .labor-sub-row').forEach(r => {
                const w = parseFloat(r.querySelector('.l-wip').innerText) || 0;
                const func = r.querySelector('.l-func').value;
                if (w > 0 && stage && func && stage !== "ADD_NEW" && func !== "ADD_NEW") {
                    totalWipCost += w;
                    const match = this.qboAccounts.find(a => a.name.toLowerCase() === `LBR - ${stage} - ${func}`.toLowerCase());
                    const cat = match ? match.name : '<span style="color:red">Unmapped</span>';
                    creditLines.push(`<tr><td>${cat}</td><td></td><td class="col-tot calc-cell">${w.toFixed(2)}</td><td>Labor: ${stage} - ${func}</td></tr>`);
                }
            });
        });
        document.querySelectorAll('.oh-group').forEach(g => {
            const stage = g.querySelector('.o-stage').value;
            g.querySelectorAll('.oh-main-row, .oh-sub-row').forEach(r => {
                const w = parseFloat(r.querySelector('.o-wip').innerText) || 0;
                const lbl = r.querySelector('.o-label').value;
                if (w > 0 && stage && lbl && stage !== "ADD_NEW" && lbl !== "ADD_NEW") {
                    totalWipCost += w;
                    const match = this.qboAccounts.find(a => a.name.toLowerCase() === `FOH - ${stage} - ${lbl}`.toLowerCase());
                    const cat = match ? match.name : '<span style="color:red">Unmapped</span>';
                    creditLines.push(`<tr><td>${cat}</td><td></td><td class="col-tot calc-cell">${w.toFixed(2)}</td><td>Overhead: ${stage} - ${lbl}</td></tr>`);
                }
            });
        });

        const fgId = `FGD - ${this.batchData.productName}`;
        const fgMatch = this.qboAccounts.find(a => a.name.toLowerCase() === fgId.toLowerCase());
        const debitCat = fgMatch ? fgMatch.name : (this.batchData.isComplete ? "Finished Goods Inventory" : "Work In Progress Inventory");
        
        html += `<tr><td><strong>${debitCat}</strong></td><td class="col-tot calc-cell" style="font-weight:bold;">${totalWipCost.toFixed(2)}</td><td></td><td>Batch ${this.batchData.batchId} Build</td></tr>`;
        html += creditLines.join('');
        html += `</tbody></table></div>`;
        document.getElementById('costingTabContent').innerHTML = html;
    }

    renderAdjustmentTab() {
        let html = `
            <div style="margin-bottom: 10px; display:flex; gap: 15px; align-items: center; flex-wrap: wrap;">
                <div>
                    <label style="font-weight:bold;">Adjustment Date:</label>
                    <input type="date" id="adjDate" style="padding:4px; margin-left:5px;">
                </div>
                <div>
                    <label style="font-weight:bold;">Offset Account:</label>
                    <input type="text" id="adjAccount" value="Inventory Shrinkage" style="padding:4px; margin-left:5px; width:150px;" title="The account that offsets the inventory balance changes.">
                </div>
                <div style="margin-left: auto;">
                    <span style="font-size:0.85rem; color:#d35400;"><strong>Note:</strong> Pushing here creates a Quantity Adjustment in QBO. Amounts are calculated by QBO's average cost engine.</span>
                </div>
            </div>
            <div class="table-responsive">
            <table class="costing-table data-table" style="width:100% !important; min-width: 700px !important;">
                <thead><tr>
                    <th style="text-align:left; width: auto;">Line Item Generated ID</th>
                    <th style="text-align:left; width: auto;">Mapped QBO Category</th>
                    <th style="text-align:right; width: 120px;">Qty / Hrs</th>
                    <th style="text-align:right; width: 120px;">Cost Value</th>
                </tr></thead>
                <tbody>
        `;

        let totalWipCost = 0;
        const creditLines = [];

        document.querySelectorAll('.bom-row').forEach(r => {
            const w = parseFloat(r.querySelector('.b-wip').innerText) || 0;
            const q = parseFloat(r.querySelector('.b-qty').value) || 0;
            const item = r.querySelector('.b-item').value;
            if (w > 0 && item && item !== "ADD_NEW") {
                totalWipCost += w;
                const lineId = `RAW - ${item}`;
                const match = this.qboAccounts.find(a => a.name.toLowerCase() === lineId.toLowerCase());
                const cat = match ? match.name : '<span style="color:red">Unmapped</span>';
                creditLines.push(`<tr><td><strong>${lineId}</strong></td><td>${cat}</td><td class="calc-cell" style="text-align:right; white-space:nowrap;">${(-q).toFixed(2)}</td><td class="calc-cell" style="text-align:right; white-space:nowrap;">${(-w).toFixed(2)}</td></tr>`);
            }
        });
        
        document.querySelectorAll('.labor-group').forEach(g => {
            const stage = g.querySelector('.l-stage').value;
            g.querySelectorAll('.labor-main-row, .labor-sub-row').forEach(r => {
                const w = parseFloat(r.querySelector('.l-wip').innerText) || 0;
                const h = parseFloat(r.querySelector('.l-bhrs').value) || 0;
                const func = r.querySelector('.l-func').value;
                if (w > 0 && stage && func && stage !== "ADD_NEW" && func !== "ADD_NEW") {
                    totalWipCost += w;
                    const lineId = `LBR - ${stage} - ${func}`;
                    const match = this.qboAccounts.find(a => a.name.toLowerCase() === lineId.toLowerCase());
                    const cat = match ? match.name : '<span style="color:red">Unmapped</span>';
                    creditLines.push(`<tr><td><strong>${lineId}</strong></td><td>${cat}</td><td class="calc-cell" style="text-align:right; white-space:nowrap;">${(-h).toFixed(2)}</td><td class="calc-cell" style="text-align:right; white-space:nowrap;">${(-w).toFixed(2)}</td></tr>`);
                }
            });
        });
        
        document.querySelectorAll('.oh-group').forEach(g => {
            const stage = g.querySelector('.o-stage').value;
            g.querySelectorAll('.oh-main-row, .oh-sub-row').forEach(r => {
                const w = parseFloat(r.querySelector('.o-wip').innerText) || 0;
                const h = parseFloat(r.querySelector('.o-bhrs').value) || 0;
                const lbl = r.querySelector('.o-label').value;
                if (w > 0 && stage && lbl && stage !== "ADD_NEW" && lbl !== "ADD_NEW") {
                    totalWipCost += w;
                    const lineId = `FOH - ${stage} - ${lbl}`;
                    const match = this.qboAccounts.find(a => a.name.toLowerCase() === lineId.toLowerCase());
                    const cat = match ? match.name : '<span style="color:red">Unmapped</span>';
                    creditLines.push(`<tr><td><strong>${lineId}</strong></td><td>${cat}</td><td class="calc-cell" style="text-align:right; white-space:nowrap;">${(-h).toFixed(2)}</td><td class="calc-cell" style="text-align:right; white-space:nowrap;">${(-w).toFixed(2)}</td></tr>`);
                }
            });
        });

        const fgId = `FGD - ${this.batchData.productName}`;
        const fgMatch = this.qboAccounts.find(a => a.name.toLowerCase() === fgId.toLowerCase());
        const debitCat = fgMatch ? fgMatch.name : (this.batchData.isComplete ? "Finished Goods Inventory" : "Work In Progress Inventory");
        let fgQty = parseFloat(document.getElementById('y_gummies').innerText.replace(/,/g, '')) || 0;

        html += `<tr><td><strong>${fgId}</strong></td><td><strong>${debitCat}</strong></td><td class="calc-cell" style="font-weight:bold; color:#27ae60; text-align:right; white-space:nowrap;">+${fgQty.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}</td><td class="calc-cell" style="font-weight:bold; color:#27ae60; text-align:right; white-space:nowrap;">+${totalWipCost.toFixed(2)}</td></tr>`;
        
        html += creditLines.join('');
        html += `</tbody></table></div>`;
        document.getElementById('costingTabContent').innerHTML = html;
    }

    renderMappingTable() {
        const fullAccountTypes = [
            "Bank", "Accounts Receivable", "Other Current Asset", "Fixed Asset", "Other Asset", 
            "Accounts Payable", "Credit Card", "Other Current Liability", "Long Term Liability", 
            "Equity", "Income", "Other Income", "Cost of Goods Sold", "Expense", "Other Expense"
        ];

        let html = `
            <div style="margin-bottom: 10px;">
                <span style="font-size:0.9rem; color:#666;">Showing all ${this.uniqueLineItems.size} unique line items required for this batch. Data is fetched directly from QBO.</span>
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

        if (this.uniqueLineItems.size === 0) {
            html += `<tr><td colspan="6" style="text-align:center; padding: 2rem; color: #666;">No line items found. Fill out the costing tables.</td></tr>`;
        }

        const isGuest = this.userRole === 'guest';

        let i = 0;
        this.uniqueLineItems.forEach(lineItem => {
            const itemMatch = this.qboItems.find(item => item.name.toLowerCase() === lineItem.toLowerCase());
            const accMatch = this.qboAccounts.find(acc => acc.name.toLowerCase() === lineItem.toLowerCase());

            const itemInQbo = !!itemMatch;
            const accInQbo = !!accMatch;
            const isFullyMapped = itemInQbo && accInQbo;

            // Generate Account Dropdown
            let accDropdownHtml = `<select id="unmap-cat-${i}" style="padding:0.4rem; width:100%; box-sizing: border-box;" onchange="window.toggleNewAccountInput(${i}, this.value)">`;
            accDropdownHtml += `<option value="">Select Existing QBO Account...</option>`;
            accDropdownHtml += `<option value="ADD_NEW" style="font-weight:bold; color:var(--btn-bg);">+ Create New Account</option>`;
            this.qboAccounts.forEach(acc => {
                const selected = accInQbo && acc.id === accMatch.id ? 'selected' : '';
                accDropdownHtml += `<option value="${acc.id}" data-name="${acc.name}" data-type="${acc.type}" ${selected}>${acc.name} (${acc.type})</option>`;
            });
            accDropdownHtml += `</select>`;
            accDropdownHtml += `<input type="text" id="new-cat-name-${i}" placeholder="Enter new account name" style="display:none; margin-top:5px; padding:0.4rem; width:100%; box-sizing: border-box;" value="${lineItem}">`;

            // Generate Full Account Type Dropdown
            let typeDropdownHtml = `<select id="unmap-type-${i}" style="padding:0.4rem; width:100%; box-sizing: border-box;" ${accInQbo ? 'disabled' : ''}>`;
            let defaultType = lineItem.startsWith('RAW') || lineItem.startsWith('FGD') ? 'Other Current Asset' : 'Cost of Goods Sold';
            fullAccountTypes.forEach(t => {
                const selected = accMatch && accMatch.type === t ? 'selected' : (t === defaultType ? 'selected' : '');
                typeDropdownHtml += `<option value="${t}" ${selected}>${t}</option>`;
            });
            typeDropdownHtml += `</select>`;

            // Determine Item Type
            let defaultItemType = lineItem.startsWith('LBR') || lineItem.startsWith('FOH') ? 'Service' : 'NonInventory';
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
        document.getElementById('costingTabContent').innerHTML = html;

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
                        isIncome: lineItem.startsWith('FGD') 
                    });
                }

                this.showAlert(`Successfully synced "${lineItem}" with QuickBooks!`, "success");
                
                await this.loadLiveQboData();
                this.renderActiveTab(); 

            } catch (err) {
                this.showAlert(err.message, "danger");
                btn.innerText = "Save to QBO"; 
                btn.disabled = (this.userRole === 'guest');
            }
        };
    }

    saveToJson() {
        const data = {
            batchData: this.batchData,
            params: {
                vol: document.getElementById('p_vol').value,
                evap: document.getElementById('p_evap').value,
                scrap: document.getElementById('p_scrap').value,
                gpl: document.getElementById('p_gpl').value,
                gpp: document.getElementById('p_gpp').value,
                packCost: document.getElementById('p_pack_cost').value,
                margin: document.getElementById('p_margin').value
            },
            bom: Array.from(document.querySelectorAll('.bom-row')).map(r => ({
                item: r.querySelector('.b-item').value,
                qty: r.querySelector('.b-qty').value,
                cost: r.querySelector('.b-cost').value,
                comp: r.querySelector('.b-comp').value
            })),
            labor: Array.from(document.querySelectorAll('.labor-group')).map(g => ({
                stageName: g.querySelector('.l-stage').value,
                rows: Array.from(g.querySelectorAll('.labor-main-row, .labor-sub-row')).map(r => ({
                    func: r.querySelector('.l-func').value,
                    mcost: r.querySelector('.l-mcost').value,
                    mhrs: r.querySelector('.l-mhrs').value,
                    bhrs: r.querySelector('.l-bhrs').value,
                    comp: r.querySelector('.l-comp').value
                }))
            })),
            oh: Array.from(document.querySelectorAll('.oh-group')).map(g => ({
                stageName: g.querySelector('.o-stage').value,
                rows: Array.from(g.querySelectorAll('.oh-main-row, .oh-sub-row')).map(r => ({
                    label: r.querySelector('.o-label').value,
                    mcost: r.querySelector('.o-mcost').value,
                    mhrs: r.querySelector('.o-mhrs').value,
                    bhrs: r.querySelector('.o-bhrs').value,
                    comp: r.querySelector('.o-comp').value
                }))
            }))
        };
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `Costing_${this.batchData.clientName}_${this.batchData.productName}_${this.batchData.batchId}.json`.replace(/\s+/g, '_');
        a.click();
    }

    loadFromJson(event) {
        const file = event.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const data = JSON.parse(e.target.result);
                
                this.batchData = data.batchData;
                document.getElementById('dashboard-title-display').innerText = `${this.batchData.clientName} - ${this.batchData.productName}_${this.batchData.batchId}`;
                document.getElementById('lock-overlay').style.display = 'none';

                document.getElementById('p_vol').value = data.params.vol;
                document.getElementById('p_evap').value = data.params.evap;
                document.getElementById('p_scrap').value = data.params.scrap;
                document.getElementById('p_gpl').value = data.params.gpl;
                document.getElementById('p_gpp').value = data.params.gpp;
                
                if (document.getElementById('p_pack_cost') && data.params.packCost) document.getElementById('p_pack_cost').value = data.params.packCost;
                if (document.getElementById('p_margin') && data.params.margin) document.getElementById('p_margin').value = data.params.margin;

                document.getElementById('bom-tbody').innerHTML = '';
                data.bom.forEach(r => this.addBomRow(r.item, r.qty, r.cost, r.comp));

                document.querySelectorAll('.labor-group').forEach(e => e.remove());
                if(data.labor) data.labor.forEach(g => this.addLaborStageGroup(g.stageName, g.rows));

                document.querySelectorAll('.oh-group').forEach(e => e.remove());
                if(data.oh) data.oh.forEach(g => this.addOhStageGroup(g.stageName, g.rows));

                this.calculateAll();
                this.showAlert("JSON loaded successfully!", "success");
            } catch (err) {
                this.showAlert("Failed to parse JSON file.", "danger");
            }
        };
        reader.readAsText(file);
        event.target.value = '';
    }

    exportToExcel() {
        let style = `<style>
            table { border-collapse: collapse; width: 100%; font-family: sans-serif; font-size: 13px; }
            th, td { border: 1px solid #D9D9D9; padding: 5px; }
            th { background-color: #1F4E78; color: #FFFFFF; font-weight: bold; text-align: center; }
            .label-cell { background-color: #D9E1F2; font-weight: bold; }
            .calc-cell { background-color: #F2F2F2; text-align: right; }
            .total-row td { background-color: #D9E1F2; font-weight: bold; border-top: 2px solid #1F4E78; }
        </style>`;
        let html = "<html xmlns:x='urn:schemas-microsoft-com:office:excel'><head><meta charset='utf-8'>" + style + "</head><body>";
        html += `<h2>COSTING ANALYSIS: ${this.batchData.clientName} - ${this.batchData.productName}_${this.batchData.batchId}</h2><br>`;
        
        const tables = document.querySelectorAll('.costing-table');
        tables.forEach(table => {
            let clone = table.cloneNode(true);
            let actions = clone.querySelectorAll('.btn-add, .btn-del, button');
            actions.forEach(el => {
                const p = el.parentNode;
                if(p) p.remove();
            });
            
            let inputs = table.querySelectorAll('input, select');
            let cloneInputs = clone.querySelectorAll('input, select');
            for (let i = 0; i < inputs.length; i++) {
                let val = inputs[i].value;
                let parent = cloneInputs[i].parentNode;
                if (inputs[i].type === 'number') {
                    parent.style.textAlign = 'right';
                    parent.style.backgroundColor = '#FFF2CC'; 
                } else {
                    parent.style.backgroundColor = '#FFF2CC';
                }
                parent.innerText = val;
            }
            html += clone.outerHTML + "<br><br>";
        });
        html += "</body></html>";
        
        let blob = new Blob([html], { type: 'application/vnd.ms-excel' });
        let a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `Costing_${this.batchData.clientName}_${this.batchData.productName}.xls`.replace(/\s+/g, '_');
        a.click();
    }

    async handlePushToQbo() {
        const qboSelect = document.getElementById('qboSelect');
        if (!qboSelect || !qboSelect.value) return this.showAlert("Please connect and select a QBO account first.", "warning");
        if (this.activeMainTab === 'mapping') return this.showAlert("You cannot push the Mapping tab directly. Please select the Journal or Inventory Adjustment tab.", "warning");

        const btn = document.getElementById('pushQboBtn');
        const origText = btn.innerText;
        btn.innerText = "Pushing to QBO...";
        btn.disabled = true;
        
        const statusText = document.getElementById('pushStatusText');
        if (statusText) statusText.innerText = "Initializing push connection...";

        try {
            const realmId = qboSelect.value;
            
            if (this.activeMainTab === 'general_journal') {
                const txnDate = document.getElementById('journalDate').value;
                const lines = [];
                
                document.querySelectorAll('#costingTabContent tbody tr').forEach(tr => {
                    const accName = tr.cells[0].innerText.trim();
                    const debit = parseFloat(tr.cells[1].innerText.replace(/,/g, '')) || 0;
                    const credit = parseFloat(tr.cells[2].innerText.replace(/,/g, '')) || 0;
                    const memo = tr.cells[3].innerText.trim();
                    
                    if (debit > 0) lines.push({ description: memo, amount: debit, postingType: "Debit", accountName: accName });
                    if (credit > 0) lines.push({ description: memo, amount: credit, postingType: "Credit", accountName: accName });
                });

                if (lines.length === 0) throw new Error("No non-zero costs available to push.");

                const pushCostingJournalEntry = httpsCallable(functions, 'pushCostingJournalEntry');
                const res = await pushCostingJournalEntry({ realmId, lines, txnDate, privateNote: `VilBooks Costing: Batch ${this.batchData.batchId}` });
                this.showAlert(`Journal Entry successfully pushed! (QBO ID: ${res.data.qboResponseId})`, "success");
                if (statusText) statusText.innerText = "Push completed successfully!";

            } else if (this.activeMainTab === 'adjustment_entry') {
                const adjDate = document.getElementById('adjDate').value;
                const adjAccountName = document.getElementById('adjAccount').value;
                
                const lines = [];
                document.querySelectorAll('#costingTabContent tbody tr').forEach(tr => {
                    const lineId = tr.cells[0].innerText.trim();
                    const qty = parseFloat(tr.cells[2].innerText.replace(/,/g, '')) || 0;
                    
                    if (qty !== 0) {
                        lines.push({
                            itemName: lineId,
                            qtyDiff: qty.toString()
                        });
                    }
                });

                if (lines.length === 0) throw new Error("No non-zero lines available to push.");

                const pushInventoryAdjustment = httpsCallable(functions, 'pushInventoryAdjustment');
                const res = await pushInventoryAdjustment({ realmId, lines, adjDate, adjAccountName });
                this.showAlert(`Inventory Quantity Adjustment successfully pushed! (QBO ID: ${res.data.qboResponseId})`, "success");
                if (statusText) statusText.innerText = "Push completed successfully!";
            }
        } catch (err) {
            this.showAlert(err.message, "danger");
            if (statusText) statusText.innerText = "Push failed. Check alerts.";
        } finally {
            btn.innerText = origText;
            btn.disabled = (this.userRole === 'guest');
        }
    }

    showAlert(message, type = "warning") {
        const box = document.getElementById('alertBox');
        box.innerHTML = message;
        box.className = `alert alert-${type} visible`;
    }
}
