import { db, functions } from './auth.js';
import { collection, doc, getDoc, setDoc, getDocs, writeBatch } from "https://www.gstatic.com/firebasejs/12.11.0/firebase-firestore.js";
import { httpsCallable } from "https://www.gstatic.com/firebasejs/12.11.0/firebase-functions.js";
import { currentUser } from './app.js';

export default class BatchProductCosting {
    constructor() {
        this.categoriesDict = {};
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
        
        // Generated Data
        this.uniqueLineItems = new Set();
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
                .costing-dashboard { width: 100%; background: #fff; padding: 15px; box-shadow: 0 4px 15px rgba(0,0,0,0.1); border-radius: 8px; }
                .costing-dashboard h2 { color: var(--header-bg); font-size: 14px; margin-top: 15px; margin-bottom: 5px; text-transform: uppercase; }
                .main-layout { display: flex; gap: 20px; flex-wrap: wrap; align-items: flex-start; }
                .left-column { flex: 1.5; min-width: 60%; display: flex; flex-direction: column; gap: 10px; }
                .right-column { flex: 1; min-width: 35%; display: flex; flex-direction: column; gap: 10px; }
                .table-responsive { width: 100%; overflow-x: auto; margin-bottom: 10px; }
                table.costing-table { width: 100%; border-collapse: collapse; font-size: 0.85rem; }
                table.costing-table th, table.costing-table td { border: 1px solid var(--border-color); padding: 4px; text-align: left; }
                table.costing-table th { background-color: var(--header-bg); color: var(--header-text); text-align: center; font-weight: normal; }
                .label-cell { background-color: var(--accent-bg); font-weight: bold; }
                .calc-cell { background-color: var(--calc-bg); text-align: right; }
                .costing-table input, .costing-table select { width: 100%; box-sizing: border-box; background-color: var(--input-bg); border: 1px solid #ccc; padding: 3px; }
                .costing-table input[type="number"] { text-align: right; }
                .total-row td { font-weight: bold; background-color: var(--accent-bg); border-top: 2px solid var(--header-bg); }
                .btn-add { background-color: var(--btn-bg); color: white; border: none; padding: 2px 8px; cursor: pointer; }
                .btn-del { background-color: var(--btn-del); color: white; border: none; padding: 2px 8px; cursor: pointer; }
                
                #lock-overlay { position: absolute; top: 0; left: 0; width: 100%; height: 100%; background: rgba(255,255,255,0.9); z-index: 1000; display: flex; align-items: center; justify-content: center; backdrop-filter: blur(5px); }
                .lock-modal { background: #f8f9fa; border: 2px solid var(--header-bg); padding: 2rem; border-radius: 8px; box-shadow: 0 10px 25px rgba(0,0,0,0.2); width: 400px; }
                .lock-modal input { width: 100%; padding: 0.5rem; margin-bottom: 1rem; border: 1px solid #ccc; border-radius: 4px; }
            </style>

            <div class="container" style="padding-top: 0.25rem;">
                <h2 style="margin-top: 0; margin-bottom: 0.25rem; font-size: 1.4rem;">VilBooks: Infused Product Costing</h2>
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
                            <button class="btn" id="unlockBtn" style="width: 100%;">Generate Batch Workspace</button>
                        </div>
                    </div>

                    <h2 id="dashboard-title-display" style="font-size: 18px; border-bottom: 3px solid var(--header-bg); padding-bottom: 5px; margin-top:0;">[AWAITING INITIALIZATION]</h2>

                    <div class="main-layout">
                        <div class="left-column">
                            <div>
                                <h2>1. Batch Production Parameters</h2>
                                <div class="table-responsive">
                                    <table class="costing-table" id="params-table">
                                        <tr><td class="label-cell" style="width:60%;">Input Target Volume (Liters)</td><td><input type="number" id="p_vol" class="calc-trigger" value="50.00"></td></tr>
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
                                    <table class="costing-table" id="bom-table">
                                        <thead>
                                            <tr>
                                                <th style="width: 30px;"><button class="btn-add" id="addBomBtn">+</button></th>
                                                <th>Raw Material Ingredient</th>
                                                <th style="width:70px;">Qty</th>
                                                <th style="width:80px;">Cost/Unit</th>
                                                <th style="width:90px;">Total Batch Material Cost</th>
                                                <th style="width:60px;">% Comp</th>
                                                <th style="width:90px;" class="dynamic-cost-header">WIP Cost</th>
                                            </tr>
                                        </thead>
                                        <tbody id="bom-tbody"></tbody>
                                        <tr class="total-row">
                                            <td colspan="4" style="text-align: right;">TOTAL RAW MATERIAL COST:</td>
                                            <td class="calc-cell" id="bom_cost_total">$0.00</td>
                                            <td></td>
                                            <td class="calc-cell" id="bom_wip_total">$0.00</td>
                                        </tr>
                                    </table>
                                </div>
                            </div>

                            <div>
                                <h2>3. Labor Burden Calculator</h2>
                                <div class="table-responsive">
                                    <table class="costing-table" id="labor-table">
                                        <thead>
                                            <tr>
                                                <th style="width: 30px;"><button class="btn-add" id="addLaborBtn">+</button></th>
                                                <th>Production Stage</th>
                                                <th>Employee Function</th>
                                                <th style="width:80px;">Total Rate</th>
                                                <th style="width:80px;">Batch Hrs</th>
                                                <th style="width:90px;">Total Batch Labor Cost</th>
                                                <th style="width:60px;">% Comp</th>
                                                <th style="width:90px;" class="dynamic-cost-header">WIP Cost</th>
                                            </tr>
                                        </thead>
                                        <tbody id="labor-tbody"></tbody>
                                        <tr class="total-row">
                                            <td colspan="5" style="text-align: right;">TOTAL BATCH LABOR COST:</td>
                                            <td class="calc-cell" id="labor_cost_total">$0.00</td>
                                            <td></td>
                                            <td class="calc-cell" id="labor_wip_total">$0.00</td>
                                        </tr>
                                    </table>
                                </div>
                            </div>

                            <div>
                                <h2>4. Straight Overhead Calculator</h2>
                                <div class="table-responsive">
                                    <table class="costing-table" id="overhead-table">
                                        <thead>
                                            <tr>
                                                <th style="width: 30px;"><button class="btn-add" id="addOhBtn">+</button></th>
                                                <th>Production Stage</th>
                                                <th>Overhead Cost Label</th>
                                                <th style="width:80px;">Total Rate</th>
                                                <th style="width:80px;">Batch Hrs</th>
                                                <th style="width:90px;">Total Batch O.H. Cost</th>
                                                <th style="width:60px;">% Comp</th>
                                                <th style="width:90px;" class="dynamic-cost-header">WIP Cost</th>
                                            </tr>
                                        </thead>
                                        <tbody id="oh-tbody"></tbody>
                                        <tr class="total-row">
                                            <td colspan="5" style="text-align: right;">TOTAL BATCH O.H. COST:</td>
                                            <td class="calc-cell" id="oh_cost_total">$0.00</td>
                                            <td></td>
                                            <td class="calc-cell" id="oh_wip_total">$0.00</td>
                                        </tr>
                                    </table>
                                </div>
                            </div>
                        </div>

                        <div class="right-column">
                            <div>
                                <h2>5. Process Yield & Unit Cost Summary</h2>
                                <div class="table-responsive">
                                    <table class="costing-table" id="yield-table">
                                        <tr><td class="label-cell" style="width:60%;">Starting Volume (Liters)</td><td class="calc-cell" id="y_start">0.00</td></tr>
                                        <tr><td class="label-cell">Less: Evaporation Loss</td><td class="calc-cell" id="y_evap">0.00</td></tr>
                                        <tr><td class="label-cell">Less: Molding Scrap</td><td class="calc-cell" id="y_scrap">0.00</td></tr>
                                        <tr><td class="label-cell" style="font-weight: bold;">Net Finished Volume (Liters)</td><td class="calc-cell" id="y_net" style="font-weight: bold;">0.00</td></tr>
                                        <tr><td class="label-cell" style="font-weight: bold;">Total Gross Gummies Produced</td><td class="calc-cell" id="y_gummies" style="font-weight: bold;">0</td></tr>
                                        <tr><td colspan="2" style="border: none; padding: 5px;"></td></tr>
                                        <tr class="total-row"><td class="label-cell">TOTAL BATCH COST</td><td class="calc-cell" id="s_batch_cost">$0.00</td></tr>
                                        <tr><td class="label-cell">COST PER FINISHED GUMMY</td><td class="calc-cell" id="s_cpg" style="font-weight: bold;">$0.00</td></tr>
                                        <tr><td colspan="2" style="border: none; padding: 5px;"></td></tr>
                                        <tr><td class="label-cell">Total Cost of Gummies per Pack</td><td class="calc-cell" id="s_cost_per_pack_gummies">$0.00</td></tr>
                                        <tr><td class="label-cell">Add: Packaging Cost per Pack</td><td><input type="number" id="p_pack_cost" class="calc-trigger" value="0.18"></td></tr>
                                        <tr class="total-row"><td class="label-cell">TOTAL COST PER PACK / BAG</td><td class="calc-cell" id="s_total_pack_cost" style="font-weight: bold;">$0.00</td></tr>
                                    </table>
                                </div>
                            </div>
                        </div>
                    </div>

                    <div style="margin-top: 2rem;">
                        <div class="tabs main-tabs" style="border-bottom: 2px solid #27ae60; margin-bottom: 0; display:flex;">
                            <button class="tab active" data-maintab="general_journal">General Journal</button>
                            <button class="tab" data-maintab="adjustment_entry">Adjustment Entry</button>
                            <button class="tab" data-maintab="mapping" style="color: #e74c3c;">Mapping</button>
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

        // Load Global Dictionaries and Overrides for mapping
        await this.loadCategories();
        // Load Dropdown Options
        await this.loadDropdownCollections();

        document.getElementById('addBomBtn').addEventListener('click', () => this.addBomRow());
        document.getElementById('addLaborBtn').addEventListener('click', () => this.addLaborRow());
        document.getElementById('addOhBtn').addEventListener('click', () => this.addOhRow());

        document.querySelectorAll('.calc-trigger').forEach(el => el.addEventListener('input', () => this.calculateAll()));

        document.querySelectorAll('.main-tabs .tab').forEach(tab => {
            tab.addEventListener('click', (e) => {
                document.querySelectorAll('.main-tabs .tab').forEach(t => t.classList.remove('active'));
                e.target.classList.add('active');
                this.activeMainTab = e.target.dataset.maintab;
                this.renderActiveTab();
            });
        });

        // Initialize with default rows
        this.addBomRow();
        this.addLaborRow();
        this.addOhRow();
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

    generateSelectHtml(options, className, onchangeStr) {
        let html = `<select class="${className}" onchange="if(this.value==='ADD_NEW'){window.addNewDropdownItem(this, '${className}')} else {${onchangeStr}}">`;
        html += `<option value="">Select...</option>`;
        options.forEach(opt => html += `<option value="${opt}">${opt}</option>`);
        html += `<option value="ADD_NEW" style="font-weight:bold; color:var(--btn-bg);">+ Add New Item</option>`;
        html += `</select>`;
        return html;
    }

    attachAddNewLogic() {
        window.addNewDropdownItem = async (selectEl, className) => {
            const newVal = prompt("Enter the name of the new item:");
            if (!newVal || newVal.trim() === "") {
                selectEl.value = ""; // Reset
                return;
            }
            
            let colName = "";
            if (className.includes('b-item')) colName = "rawMaterials";
            if (className.includes('stage')) colName = "productionStages";
            if (className.includes('l-func')) colName = "laborItems";
            if (className.includes('o-label')) colName = "overheadItems";

            try {
                const addCostingDropdownItem = httpsCallable(functions, 'addCostingDropdownItem');
                await addCostingDropdownItem({ collectionName: colName, itemName: newVal.trim() });
                
                // Add to local array and re-render dropdowns
                if (colName === "rawMaterials") this.rawMaterials.push(newVal.trim());
                if (colName === "productionStages") this.productionStages.push(newVal.trim());
                if (colName === "laborItems") this.laborItems.push(newVal.trim());
                if (colName === "overheadItems") this.overheadItems.push(newVal.trim());
                
                this.showAlert(`${newVal} added successfully!`, "success");
                
                // Add option to current select and choose it
                const opt = document.createElement('option');
                opt.value = newVal.trim();
                opt.innerText = newVal.trim();
                selectEl.insertBefore(opt, selectEl.lastElementChild);
                selectEl.value = newVal.trim();
                this.calculateAll();

            } catch (e) {
                this.showAlert("Failed to add new item.", "danger");
                selectEl.value = "";
            }
        };
    }

    addBomRow() {
        const tr = document.createElement('tr');
        tr.className = 'bom-row line-row';
        tr.innerHTML = `
            <td><button class="btn-del" onclick="this.closest('tr').remove(); window.calcTrigger()">-</button></td>
            <td>${this.generateSelectHtml(this.rawMaterials, 'b-item', 'window.calcTrigger()')}</td>
            <td><input type="number" class="b-qty calc-trigger" value="0"></td>
            <td><input type="number" class="b-cost calc-trigger" value="0"></td>
            <td class="calc-cell b-total">0.00</td>
            <td><input type="number" class="b-comp calc-trigger" value="100" max="100" min="0"></td>
            <td class="calc-cell b-wip">0.00</td>
        `;
        document.getElementById('bom-tbody').appendChild(tr);
        this.attachTriggers();
    }

    addLaborRow() {
        const tr = document.createElement('tr');
        tr.className = 'labor-row line-row';
        tr.innerHTML = `
            <td><button class="btn-del" onclick="this.closest('tr').remove(); window.calcTrigger()">-</button></td>
            <td>${this.generateSelectHtml(this.productionStages, 'l-stage', 'window.calcTrigger()')}</td>
            <td>${this.generateSelectHtml(this.laborItems, 'l-func', 'window.calcTrigger()')}</td>
            <td><input type="number" class="l-rate calc-trigger" value="0"></td>
            <td><input type="number" class="l-bhrs calc-trigger" value="0"></td>
            <td class="calc-cell l-total">0.00</td>
            <td><input type="number" class="l-comp calc-trigger" value="100" max="100" min="0"></td>
            <td class="calc-cell l-wip">0.00</td>
        `;
        document.getElementById('labor-tbody').appendChild(tr);
        this.attachTriggers();
    }

    addOhRow() {
        const tr = document.createElement('tr');
        tr.className = 'oh-row line-row';
        tr.innerHTML = `
            <td><button class="btn-del" onclick="this.closest('tr').remove(); window.calcTrigger()">-</button></td>
            <td>${this.generateSelectHtml(this.productionStages, 'o-stage', 'window.calcTrigger()')}</td>
            <td>${this.generateSelectHtml(this.overheadItems, 'o-label', 'window.calcTrigger()')}</td>
            <td><input type="number" class="o-rate calc-trigger" value="0"></td>
            <td><input type="number" class="o-bhrs calc-trigger" value="0"></td>
            <td class="calc-cell o-total">0.00</td>
            <td><input type="number" class="o-comp calc-trigger" value="100" max="100" min="0"></td>
            <td class="calc-cell o-wip">0.00</td>
        `;
        document.getElementById('oh-tbody').appendChild(tr);
        this.attachTriggers();
    }

    attachTriggers() {
        window.calcTrigger = () => this.calculateAll();
        document.querySelectorAll('.calc-trigger').forEach(el => {
            el.removeEventListener('input', window.calcTrigger);
            el.addEventListener('input', window.calcTrigger);
        });
        this.attachAddNewLogic();
    }

    calculateAll() {
        // Yield Logic
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

        // Check Completion Status
        let allComplete = true;
        document.querySelectorAll('.b-comp, .l-comp, .o-comp').forEach(input => {
            if ((parseFloat(input.value) || 0) < 100) allComplete = false;
        });
        this.batchData.isComplete = allComplete;
        
        const dynamicHeader = allComplete ? "FG Cost" : "WIP Cost";
        document.querySelectorAll('.dynamic-cost-header').forEach(th => th.innerText = dynamicHeader);

        // Collect Unique Line Items for Mapping
        this.uniqueLineItems.clear();
        this.uniqueLineItems.add(`fgd[${this.batchData.productName}]`);

        // BOM Math
        let bomTot = 0, bomWipTot = 0;
        document.querySelectorAll('.bom-row').forEach(row => {
            let q = parseFloat(row.querySelector('.b-qty').value) || 0;
            let c = parseFloat(row.querySelector('.b-cost').value) || 0;
            let comp = (parseFloat(row.querySelector('.b-comp').value) || 0) / 100;
            let item = row.querySelector('.b-item').value;
            if(item && item !== "ADD_NEW") this.uniqueLineItems.add(`raw[${item}]`);
            
            let tot = q * c;
            let wip = tot * comp;
            bomTot += tot; bomWipTot += wip;
            row.querySelector('.b-total').innerText = tot.toFixed(2);
            row.querySelector('.b-wip').innerText = wip.toFixed(2);
        });
        document.getElementById('bom_cost_total').innerText = bomTot.toFixed(2);
        document.getElementById('bom_wip_total').innerText = bomWipTot.toFixed(2);

        // Labor Math
        let labTot = 0, labWipTot = 0;
        document.querySelectorAll('.labor-row').forEach(row => {
            let r = parseFloat(row.querySelector('.l-rate').value) || 0;
            let h = parseFloat(row.querySelector('.l-bhrs').value) || 0;
            let comp = (parseFloat(row.querySelector('.l-comp').value) || 0) / 100;
            let stage = row.querySelector('.l-stage').value;
            let func = row.querySelector('.l-func').value;
            if(stage && func && stage !== "ADD_NEW" && func !== "ADD_NEW") this.uniqueLineItems.add(`lbr[${stage}]-[${func}]`);

            let tot = r * h;
            let wip = tot * comp;
            labTot += tot; labWipTot += wip;
            row.querySelector('.l-total').innerText = tot.toFixed(2);
            row.querySelector('.l-wip').innerText = wip.toFixed(2);
        });
        document.getElementById('labor_cost_total').innerText = labTot.toFixed(2);
        document.getElementById('labor_wip_total').innerText = labWipTot.toFixed(2);

        // OH Math
        let ohTot = 0, ohWipTot = 0;
        document.querySelectorAll('.oh-row').forEach(row => {
            let r = parseFloat(row.querySelector('.o-rate').value) || 0;
            let h = parseFloat(row.querySelector('.o-bhrs').value) || 0;
            let comp = (parseFloat(row.querySelector('.o-comp').value) || 0) / 100;
            let stage = row.querySelector('.o-stage').value;
            let label = row.querySelector('.o-label').value;
            if(stage && label && stage !== "ADD_NEW" && label !== "ADD_NEW") this.uniqueLineItems.add(`foh[${stage}]-[${label}]`);

            let tot = r * h;
            let wip = tot * comp;
            ohTot += tot; ohWipTot += wip;
            row.querySelector('.o-total').innerText = tot.toFixed(2);
            row.querySelector('.o-wip').innerText = wip.toFixed(2);
        });
        document.getElementById('oh_cost_total').innerText = ohTot.toFixed(2);
        document.getElementById('oh_wip_total').innerText = ohWipTot.toFixed(2);

        // Summary Math
        let batchCost = bomTot + labTot + ohTot; 
        document.getElementById('s_batch_cost').innerText = batchCost.toFixed(2);
        let costPerGummy = grossGummies > 0 ? (batchCost / grossGummies) : 0;
        document.getElementById('s_cpg').innerText = costPerGummy.toFixed(2);

        let costOfGummiesPerPack = costPerGummy * gpp;
        document.getElementById('s_cost_per_pack_gummies').innerText = costOfGummiesPerPack.toFixed(2);
        let packCost = parseFloat(document.getElementById('p_pack_cost').value) || 0;
        let totalCostPerPack = costOfGummiesPerPack + packCost;
        document.getElementById('s_total_pack_cost').innerText = totalCostPerPack.toFixed(2);

        // Update Active Bottom Tab automatically if they type
        if(document.getElementById('costingTabContent').innerHTML.trim() !== "") {
            this.renderActiveTab();
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
            <table class="costing-table">
                <thead><tr>
                    <th>Account</th>
                    <th style="text-align:right;">Debit</th>
                    <th style="text-align:right;">Credit</th>
                    <th>Memo</th>
                </tr></thead>
                <tbody>
        `;

        const debitAccount = this.batchData.isComplete ? "Finished Goods Inventory" : "Work In Progress Inventory";
        
        let totalWipCost = 0;
        const creditLines = [];

        // Gather Credits based on WIP values
        document.querySelectorAll('.bom-row').forEach(r => {
            const w = parseFloat(r.querySelector('.b-wip').innerText) || 0;
            const item = r.querySelector('.b-item').value;
            if (w > 0 && item) {
                totalWipCost += w;
                const cat = (this.categoriesDict[`raw[${item}]`] || {}).category || '<span style="color:red">Unmapped</span>';
                creditLines.push(`<tr><td>${cat}</td><td></td><td style="text-align:right;">${w.toFixed(2)}</td><td>Raw Mat: ${item}</td></tr>`);
            }
        });
        document.querySelectorAll('.labor-row').forEach(r => {
            const w = parseFloat(r.querySelector('.l-wip').innerText) || 0;
            const stage = r.querySelector('.l-stage').value;
            const func = r.querySelector('.l-func').value;
            if (w > 0 && stage && func) {
                totalWipCost += w;
                const cat = (this.categoriesDict[`lbr[${stage}]-[${func}]`] || {}).category || '<span style="color:red">Unmapped</span>';
                creditLines.push(`<tr><td>${cat}</td><td></td><td style="text-align:right;">${w.toFixed(2)}</td><td>Labor: ${stage} - ${func}</td></tr>`);
            }
        });
        document.querySelectorAll('.oh-row').forEach(r => {
            const w = parseFloat(r.querySelector('.o-wip').innerText) || 0;
            const stage = r.querySelector('.o-stage').value;
            const lbl = r.querySelector('.o-label').value;
            if (w > 0 && stage && lbl) {
                totalWipCost += w;
                const cat = (this.categoriesDict[`foh[${stage}]-[${lbl}]`] || {}).category || '<span style="color:red">Unmapped</span>';
                creditLines.push(`<tr><td>${cat}</td><td></td><td style="text-align:right;">${w.toFixed(2)}</td><td>Overhead: ${stage} - ${lbl}</td></tr>`);
            }
        });

        // Debit Line
        const debitCat = (this.categoriesDict[`fgd[${this.batchData.productName}]`] || {}).category || debitAccount;
        html += `<tr><td><strong>${debitCat}</strong></td><td style="text-align:right; font-weight:bold;">${totalWipCost.toFixed(2)}</td><td></td><td>Batch ${this.batchData.batchId} Build</td></tr>`;
        
        html += creditLines.join('');
        html += `</tbody></table>`;
        document.getElementById('costingTabContent').innerHTML = html;
    }

    renderAdjustmentTab() {
        let html = `
            <div style="margin-bottom: 10px;">
                <label style="font-weight:bold;">Adjustment Date:</label>
                <input type="date" id="adjDate" style="padding:4px; margin-left:10px;">
            </div>
            <table class="costing-table">
                <thead><tr>
                    <th>Line Item Generated ID</th>
                    <th>Mapped QBO Category</th>
                    <th style="text-align:right;">Cost Value</th>
                </tr></thead>
                <tbody>
        `;

        this.uniqueLineItems.forEach(lineItem => {
            const cat = (this.categoriesDict[lineItem] || {}).category || '<span style="color:red">Unmapped</span>';
            // Find cost based on lineItem type by calculating again or just showing structure (Showing structure for simplicity of adjustment view)
            html += `<tr><td><strong>${lineItem}</strong></td><td>${cat}</td><td style="text-align:right; color:#888;">[Calculated from table]</td></tr>`;
        });

        html += `</tbody></table>`;
        document.getElementById('costingTabContent').innerHTML = html;
    }

    renderMappingTable() {
        let html = `
            <div style="margin-bottom: 10px;">
                <span style="font-size:0.9rem; color:#666;">Showing all ${this.uniqueLineItems.size} unique line items required for this batch. Overrides are saved specifically to the active QBO Company.</span>
            </div>
            <div class="table-responsive">
            <table class="costing-table"><thead><tr>
                <th>Line Item</th>
                <th>Company QBO Account Name</th>
                <th>Account Type</th>
                <th style="text-align:center;">Source</th>
                <th>Description</th>
                <th style="text-align:center;">Action</th>
            </tr></thead><tbody>
        `;

        if (this.uniqueLineItems.size === 0) {
            html += `<tr><td colspan="6" style="text-align:center; padding: 2rem; color: #666;">No line items found. Fill out the costing tables.</td></tr>`;
        }

        let i = 0;
        this.uniqueLineItems.forEach(lineItem => {
            const dictEntry = this.categoriesDict[lineItem];
            const suggestedCategory = dictEntry ? dictEntry.category : '';
            const suggestedType = dictEntry ? dictEntry.accountType : 'Expense';
            const mappingSource = dictEntry ? dictEntry.source : 'unmapped';

            let sourceBadge = mappingSource === 'default' ? `<span style="background:#e9ecef; padding:2px 6px; border-radius:4px; font-size:0.75rem; color:#8e44ad; font-weight:bold;">Global Default</span>` :
                              mappingSource === 'company' ? `<span style="background:#e8f8f5; padding:2px 6px; border-radius:4px; font-size:0.75rem; color:#27ae60; font-weight:bold;">Company</span>` :
                              `<span style="background:#fdedec; padding:2px 6px; border-radius:4px; font-size:0.75rem; color:#e74c3c; font-weight:bold;">Unmapped</span>`;

            html += `<tr>
                <td><strong>${lineItem}</strong></td>
                <td><input type="text" id="unmap-cat-${i}" value="${suggestedCategory}" placeholder="QBO Account Name" style="padding:0.4rem; width:100%; box-sizing: border-box;"></td>
                <td>
                    <select id="unmap-type-${i}" style="padding:0.4rem; width:100%; box-sizing: border-box;">
                        <option value="Income" ${suggestedType === 'Income' ? 'selected' : ''}>Income</option>
                        <option value="Expense" ${suggestedType === 'Expense' ? 'selected' : ''}>Expense</option>
                        <option value="Bank" ${suggestedType === 'Bank' ? 'selected' : ''}>Bank / Clearing</option>
                        <option value="OtherCurrentAsset" ${suggestedType === 'OtherCurrentAsset' ? 'selected' : ''}>Other Current Asset</option>
                        <option value="CostOfGoodsSold" ${suggestedType === 'CostOfGoodsSold' ? 'selected' : ''}>Cost of Goods Sold</option>
                    </select>
                </td>
                <td style="text-align:center;">${sourceBadge}</td>
                <td><input type="text" id="unmap-desc-${i}" placeholder="Optional notes" style="padding:0.4rem; width:100%; box-sizing: border-box;"></td>
                <td style="text-align:center; display:flex; gap:5px; justify-content:center;">
                    <button class="btn" style="background:#27ae60; color:white; font-weight:bold; padding:0.4rem 0.8rem;" onclick="window.pushAndSaveCostingMapping('${lineItem}', ${i}, '${suggestedCategory}')">Save</button>
                    <button class="btn outline" style="padding:0.4rem 0.8rem;" onclick="window.viewMappingHistory('${lineItem}')">📜 History</button>
                </td>
            </tr>`;
            i++;
        });

        html += `</tbody></table></div>`;
        document.getElementById('costingTabContent').innerHTML = html;

        window.viewMappingHistory = async (lineItem) => {
            const qboSelect = document.getElementById('qboSelect');
            if (!qboSelect || !qboSelect.value) return this.showAlert("Please connect a QBO account.", "warning");
            const realmId = qboSelect.value;

            document.getElementById('historyLineItemLabel').innerText = lineItem;
            document.getElementById('mappingHistoryModal').style.display = 'flex';
            const container = document.getElementById('mappingHistoryTableContainer');
            container.innerHTML = '<p style="text-align:center; padding: 2rem;">Loading audit logs...</p>';

            try {
                const snap = await getDocs(collection(db, `qbo_companies/${realmId}/audit_logs`));
                let logs = [];
                snap.forEach(doc => {
                    const data = doc.data();
                    if (data.lineItem === lineItem) logs.push(data);
                });
                
                logs.sort((a, b) => new Date(b.modifiedAt) - new Date(a.modifiedAt));

                if (logs.length === 0) {
                    container.innerHTML = '<p style="text-align:center; padding: 2rem; color: #666;">No company-specific mapping history found for this line item.</p>';
                    return;
                }

                let logHtml = `<table style="width: 100%; border-collapse: collapse; text-align: left; font-size: 0.9rem;"><thead style="background: #f8f9fa;"><tr><th style="padding: 10px; border-bottom: 2px solid #ddd;">Date</th><th style="padding: 10px; border-bottom: 2px solid #ddd;">Action</th><th style="padding: 10px; border-bottom: 2px solid #ddd;">Category Change</th><th style="padding: 10px; border-bottom: 2px solid #ddd;">User</th></tr></thead><tbody>`;

                logs.forEach(log => {
                    const dateStr = new Date(log.modifiedAt).toLocaleString();
                    logHtml += `<tr><td style="padding: 10px; border-bottom: 1px solid #eee;">${dateStr}</td><td style="padding: 10px; border-bottom: 1px solid #eee; font-weight:bold; color: #8e44ad;">${log.action}</td><td style="padding: 10px; border-bottom: 1px solid #eee;"><span style="color:#e74c3c;">${log.oldCategory}</span> ➔ <strong style="color:#27ae60;">${log.newCategory}</strong></td><td style="padding: 10px; border-bottom: 1px solid #eee;">${log.modifiedBy}</td></tr>`;
                });
                logHtml += `</tbody></table>`;
                container.innerHTML = logHtml;
            } catch (error) {
                container.innerHTML = '<p class="text-danger" style="text-align:center;">Failed to load history.</p>';
            }
        };

        window.pushAndSaveCostingMapping = async (lineItem, index, oldCat) => {
            const catVal = document.getElementById(`unmap-cat-${index}`).value.trim();
            const typeVal = document.getElementById(`unmap-type-${index}`).value;
            const descVal = document.getElementById(`unmap-desc-${index}`).value.trim();
            const btn = event.target;

            if (!catVal) return this.showAlert("Category Name required.", "danger");
            const qboSelect = document.getElementById('qboSelect');
            if (!qboSelect || !qboSelect.value) return this.showAlert("Please connect a QBO account first.", "warning");

            btn.innerText = "Saving..."; btn.disabled = true;
            const realmId = qboSelect.value;

            try {
                const getOrCreateQboAccount = httpsCallable(functions, 'getOrCreateQboAccount');
                await getOrCreateQboAccount({ accountName: catVal, realmId: realmId, accountType: typeVal, description: descVal });

                const batch = writeBatch(db);
                const ts = new Date().toISOString();
                
                const mapRef = doc(db, `qbo_companies/${realmId}/category_mappings`, lineItem);
                batch.set(mapRef, { lineItem: lineItem, category: catVal, accountType: typeVal, description: descVal, modifiedBy: currentUser.email, modifiedAt: ts }, { merge: true });

                const logRef = doc(collection(db, `qbo_companies/${realmId}/audit_logs`));
                batch.set(logRef, { action: oldCat ? "UPDATE" : "CREATE", lineItem: lineItem, oldCategory: oldCat || "UNMAPPED", newCategory: catVal, modifiedBy: currentUser.email, modifiedAt: ts });

                await batch.commit();

                if (!this.categoriesDict[lineItem]) this.categoriesDict[lineItem] = {};
                this.categoriesDict[lineItem].category = catVal;
                this.categoriesDict[lineItem].accountType = typeVal;
                this.categoriesDict[lineItem].source = 'company';
                
                this.showAlert(`Saved "${catVal}"!`, "success");
                this.renderActiveTab(); 

            } catch (err) {
                this.showAlert(err.message, "danger");
                btn.innerText = "Save"; btn.disabled = false;
            }
        };
    }

    showAlert(message, type = "warning") {
        const box = document.getElementById('alertBox');
        box.innerHTML = message;
        box.className = `alert alert-${type} visible`;
    }
}
