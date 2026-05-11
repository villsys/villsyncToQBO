// home.js
import { db } from './auth.js'; 
import { doc, getDoc, setDoc } from "https://www.gstatic.com/firebasejs/12.11.0/firebase-firestore.js";
import { currentUser } from './app.js';

export default class Home {
    constructor() {
        this.userRole = 'guest'; 
        this.adminDataCache = {}; 
        this.adminTools = []; 
    }

    async render() {
        return `
            <style>
                .hub-container { padding: 2rem; max-width: 1200px; margin: 0 auto; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; }
                .hub-header { text-align: center; margin-bottom: 3rem; }
                .hub-header h1 { color: #1F4E78; font-size: 2.5rem; margin-bottom: 0.5rem; }
                .hub-header p { color: #666; font-size: 1.1rem; }
                
                .card-grid { display: flex; flex-wrap: wrap; gap: 20px; justify-content: center; margin-bottom: 3rem; }
                
                .tool-card { background: #fff; border: 1px solid #dee2e6; border-radius: 8px; width: 280px; min-height: 160px; padding: 1.5rem; box-shadow: 0 4px 10px rgba(0,0,0,0.05); transition: transform 0.2s, box-shadow 0.2s; display: flex; flex-direction: column; text-decoration: none; color: inherit; }
                .tool-card:hover { transform: translateY(-5px); box-shadow: 0 8px 15px rgba(0,0,0,0.1); border-color: #3498db; }
                .tool-card h3 { color: #2c3e50; margin-top: 0; margin-bottom: 0.5rem; font-size: 1.2rem; border-bottom: 2px solid #f8f9fa; padding-bottom: 0.5rem; }
                .tool-card .badge { display: inline-block; padding: 3px 8px; border-radius: 12px; font-size: 0.7rem; font-weight: bold; margin-bottom: 10px; margin-right: 5px; }
                .badge-free { background: #e8f8f5; color: #27ae60; }
                .badge-pro { background: #fdf2e9; color: #e67e22; }
                .tool-card p { font-size: 0.85rem; color: #555; flex-grow: 1; margin-bottom: 1rem; line-height: 1.4; }
                .tool-card .guest-limits { background: #f8f9fa; padding: 10px; border-radius: 4px; font-size: 0.75rem; color: #7f8c8d; border-left: 3px solid #bdc3c7; line-height: 1.3; }

                .admin-panel { background: #fff; border: 2px solid #8e44ad; border-radius: 8px; padding: 2rem; margin-top: 2rem; display: none; }
                .admin-panel h2 { color: #8e44ad; margin-top: 0; }
                .admin-form { display: flex; flex-direction: column; gap: 15px; background: #f8f9fa; padding: 1.5rem; border-radius: 6px; margin-bottom: 2rem; border: 1px solid #dee2e6; }
                .checkbox-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 10px; margin-top: 10px; }
                .checkbox-item { display: flex; align-items: center; gap: 8px; font-size: 0.9rem; color: #2c3e50; }
                .btn { padding: 8px 16px; border: none; border-radius: 4px; font-weight: bold; cursor: pointer; color: white; background: #8e44ad; transition: opacity 0.2s; }
                .btn:hover { opacity: 0.9; }
                .btn.danger { background: #e74c3c; }
                .btn.edit { background: #3498db; }
            </style>

            <div class="hub-container">
                <div class="hub-header">
                    <h1>Welcome to VillSync to QBO</h1>
                    <p>Select an integration tool below to manage your QuickBooks Online data.</p>
                </div>

                <div id="cardGridContainer" class="card-grid">
                    <p style="color: #888;">Loading your dashboard...</p>
                </div>

                <div id="superAdminPanel" class="admin-panel">
                    <h2>⚙️ Super Admin Control Panel</h2>
                    <p style="color: #666; margin-bottom: 1.5rem;">Grant or edit tool-specific admin privileges for your team members.</p>
                    
                    <div class="admin-form" id="adminFormSection">
                        <label style="font-weight: bold; color: #2c3e50;">Admin Email Address:</label>
                        <input type="email" id="newAdminEmail" placeholder="colleague@gmail.com" style="padding: 0.6rem; border: 1px solid #ccc; border-radius: 4px; width: 100%; max-width: 400px;">
                        
                        <div>
                            <label style="font-weight: bold; font-size: 0.85rem; color: #666;">Select Authorized Tools:</label>
                            <div class="checkbox-grid">
                                <label class="checkbox-item"><input type="checkbox" class="tool-cb" value="amazon"> Amazon Integrator</label>
                                <label class="checkbox-item"><input type="checkbox" class="tool-cb" value="shopify"> Shopify Integrator</label>
                                <label class="checkbox-item"><input type="checkbox" class="tool-cb" value="adpPayroll"> ADP Payroll Integrator</label>
                                <label class="checkbox-item"><input type="checkbox" class="tool-cb" value="productCost"> Product Cost Builder</label>
                                <label class="checkbox-item"><input type="checkbox" class="tool-cb" value="bulkDelete"> Bulk Delete Utility</label>
                            </div>
                        </div>
                        
                        <div style="display: flex; gap: 10px; margin-top: 10px;">
                            <button class="btn" onclick="window.saveAdmin()">Save Admin Grants</button>
                            <button class="btn outline" style="background: white; color: #666; border: 1px solid #ccc;" onclick="window.clearForm()">Cancel / Clear</button>
                        </div>
                    </div>

                    <div style="background: #fff; border: 1px solid #dee2e6; border-radius: 6px; padding: 1.5rem;">
                        <h3 style="margin-top: 0; border-bottom: 1px solid #eee; padding-bottom: 0.5rem;">Active Administrators</h3>
                        <div id="adminListContainer">Loading admins...</div>
                    </div>
                </div>
            </div>
        `;
    }

    async afterRender() {
        if (!currentUser) return;
        
        await this.checkUserRoleAndLimits();

        if (this.userRole === 'super_admin') {
            document.getElementById('superAdminPanel').style.display = 'block';
            await this.loadAdminList();
        }

        window.saveAdmin = async () => {
            const email = document.getElementById('newAdminEmail').value.trim().toLowerCase();
            if (!email) return alert("Please enter a valid email address.");

            const selectedTools = [];
            document.querySelectorAll('.tool-cb:checked').forEach(cb => selectedTools.push(cb.value));

            if (selectedTools.length === 0) {
                if (!confirm("You haven't selected any tools. Do you want to save this user with NO access? (Consider revoking them instead).")) return;
            }

            try {
                await setDoc(doc(db, "global_config", "admins"), { 
                    [email]: { tools: selectedTools, lastUpdated: new Date().toISOString() } 
                }, { merge: true });
                
                alert(`Successfully saved tool grants for ${email}!`);
                window.clearForm();
                await this.loadAdminList();
            } catch (e) {
                alert("Failed to save admin. " + e.message);
            }
        };

        window.editAdmin = (email) => {
            document.getElementById('newAdminEmail').value = email;
            
            const adminData = this.adminDataCache[email];
            let tools = [];
            
            if (adminData && typeof adminData === 'object' && Array.isArray(adminData.tools)) {
                tools = adminData.tools;
            }
            
            document.querySelectorAll('.tool-cb').forEach(cb => {
                cb.checked = tools.includes(cb.value);
            });

            document.getElementById('adminFormSection').scrollIntoView({ behavior: 'smooth' });
        };

        window.revokeAdmin = async (email) => {
            if(!confirm(`Are you sure you want to completely revoke admin privileges for ${email}?`)) return;
            try {
                await setDoc(doc(db, "global_config", "admins"), { [email]: false }, { merge: true });
                window.clearForm();
                await this.loadAdminList();
            } catch (e) {
                alert("Failed to revoke admin. " + e.message);
            }
        };

        window.clearForm = () => {
            document.getElementById('newAdminEmail').value = '';
            document.querySelectorAll('.tool-cb').forEach(cb => cb.checked = false);
        };
    }

    async checkUserRoleAndLimits() {
        if (!currentUser) return;

        this.userRole = 'guest'; 
        this.adminTools = [];
        
        if (currentUser.email === 'vnvcpas.excelimporter@gmail.com') {
            this.userRole = 'super_admin';
            this.adminTools = ['amazon', 'shopify', 'adpPayroll', 'productCost', 'bulkDelete'];
        } else {
            try {
                const adminDoc = await getDoc(doc(db, "global_config", "admins"));
                if (adminDoc.exists()) {
                    const adminData = adminDoc.data()[currentUser.email];
                    if (adminData && typeof adminData === 'object' && Array.isArray(adminData.tools)) {
                        this.userRole = 'admin';
                        this.adminTools = adminData.tools;
                    }
                }
            } catch (e) {}
        }
        
        this.renderCards();
    }

    renderCards() {
        const container = document.getElementById('cardGridContainer');
        if (!container) return;

        const isAmazonAdmin = this.adminTools.includes('amazon');
        const isShopifyAdmin = this.adminTools.includes('shopify');
        const isAdpAdmin = this.adminTools.includes('adpPayroll');
        const isProductCostAdmin = this.adminTools.includes('productCost');
        const isBulkDeleteAdmin = this.adminTools.includes('bulkDelete');

        container.innerHTML = `
            <a href="#/amazon" class="tool-card">
                <h3>Amazon Integrator</h3>
                <div><span class="badge badge-pro">Data Push Module</span></div>
                <p>Synthesize transactions generated from the Amazon <em>'Transaction View / All Account Types / Custom Date Range'</em> report and push entries directly to QBO.</p>
                <div class="guest-limits" style="border-left-color: ${isAmazonAdmin ? '#27ae60' : '#bdc3c7'}; background: ${isAmazonAdmin ? '#e8f8f5' : '#f8f9fa'};">
                    ${isAmazonAdmin 
                        ? `<strong style="color:#27ae60;">Admin Access:</strong> Has unlimited data parsing and unlimited journal entry data pushes per month.` 
                        : `<strong>Guest Access:</strong> View maps & test parsing. Uploads truncated to 10 rows. Max 10 pushes/month.`}
                </div>
            </a>

            <a href="#/shopify" class="tool-card">
                <h3>Shopify Integrator</h3>
                <div><span class="badge badge-pro">Data Push Module</span></div>
                <p>Synthesize transactions from your Shopify <em>'orders_export'</em> and <em>'payment_transactions_export'</em> reports and push entries directly to QBO.</p>
                <div class="guest-limits" style="border-left-color: ${isShopifyAdmin ? '#27ae60' : '#bdc3c7'}; background: ${isShopifyAdmin ? '#e8f8f5' : '#f8f9fa'};">
                    ${isShopifyAdmin 
                        ? `<strong style="color:#27ae60;">Admin Access:</strong> Has unlimited data parsing and unlimited individual transaction pushes per month.` 
                        : `<strong>Guest Access:</strong> View maps & test parsing. Uploads truncated to 10 rows. Max 10 pushes/month.`}
                </div>
            </a>

            <a href="#/adpPayroll" class="tool-card">
                <h3>ADP Payroll Integrator</h3>
                <div><span class="badge badge-pro">Data Push Module</span></div>
                <p>Synthesize transactions from your ADP RUN <em>'Payroll Detail Summary'</em> report to automatically allocate wages, prorate taxes, and push balanced journal entries directly to QBO.</p>
                <div class="guest-limits" style="border-left-color: ${isAdpAdmin ? '#27ae60' : '#bdc3c7'}; background: ${isAdpAdmin ? '#e8f8f5' : '#f8f9fa'};">
                    ${isAdpAdmin 
                        ? `<strong style="color:#27ae60;">Admin Access:</strong> Has unlimited data parsing and unlimited journal entry data pushes per month.` 
                        : `<strong>Guest Access:</strong> View maps & test parsing. Uploads truncated to 50 allocation lines. Max 10 pushes/month.`}
                </div>
            </a>

            <a href="#/productCostBuilder" class="tool-card">
                <h3>Product Cost Builder</h3>
                <div>
                    <span class="badge badge-free">Utility</span>
                    <span class="badge badge-pro">Data Push Module</span>
                </div>
                <p>Build Bills of Materials, calculate landed costs, estimate pricing, and push journal entries to QBO to build materials, labor, and overhead into finished goods inventory.</p>
                <div class="guest-limits" style="border-left-color: ${isProductCostAdmin ? '#27ae60' : '#bdc3c7'}; background: ${isProductCostAdmin ? '#e8f8f5' : '#f8f9fa'};">
                    ${isProductCostAdmin 
                        ? `<strong style="color:#27ae60;">Admin Access:</strong> Has full calculation access and unlimited Journal/Adjustment pushes directly to QBO.` 
                        : `<strong>Guest Access:</strong> Full calculation access. Cannot push Journal/Adjustment entries to QBO.`}
                </div>
            </a>

            <a href="#/bulkDeleteTransaction" class="tool-card">
                <h3>Bulk Delete Utility</h3>
                <div><span class="badge badge-pro">Admin Utility</span></div>
                <p>Fetch live transactions directly from QBO and safely execute bulk permanent deletions.</p>
                <div class="guest-limits" style="border-left-color: ${isBulkDeleteAdmin ? '#27ae60' : '#bdc3c7'}; background: ${isBulkDeleteAdmin ? '#e8f8f5' : '#f8f9fa'};">
                    ${isBulkDeleteAdmin 
                        ? `<strong style="color:#27ae60;">Admin Access:</strong> Has full authorization to fetch and permanently delete live QBO transactions.` 
                        : `<strong>Guest Access:</strong> Can fetch and view live QBO transactions. Deletion is strictly locked.`}
                </div>
            </a>
        `;
    }

    async loadAdminList() {
        const container = document.getElementById('adminListContainer');
        try {
            const adminDoc = await getDoc(doc(db, "global_config", "admins"));
            if (adminDoc.exists()) {
                const data = adminDoc.data();
                this.adminDataCache = data; 
                
                let html = '';
                
                Object.keys(data).forEach(email => {
                    const adminData = data[email];
                    
                    if (adminData === false || adminData === null) return;

                    let badges = '';
                    
                    if (adminData === true) {
                        badges = `<span style="color:#e67e22; font-size:0.8rem; font-style:italic;">⚠️ Legacy User - Please Edit & Assign Tools</span>`;
                    } 
                    else if (typeof adminData === 'object' && Array.isArray(adminData.tools)) {
                        if (adminData.tools.length > 0) {
                            badges = adminData.tools.map(t => `<span style="background:#e9ecef; padding:2px 6px; border-radius:4px; font-size:0.75rem; margin-right:5px; color:#34495e;">${t}</span>`).join('');
                        } else {
                            badges = `<span style="color:#7f8c8d; font-size:0.8rem; font-style:italic;">No tools assigned</span>`;
                        }
                    }

                    html += `
                    <div style="display:flex; justify-content:space-between; align-items:center; padding:0.8rem 0; border-bottom:1px solid #f1f1f1;">
                        <div>
                            <div style="font-weight:bold; color:#2c3e50; margin-bottom:4px;">${email}</div>
                            <div>${badges}</div>
                        </div>
                        <div style="display:flex; gap: 8px;">
                            <button class="btn edit" style="padding:0.4rem 0.8rem; font-size:0.8rem;" onclick="window.editAdmin('${email}')">Edit</button>
                            <button class="btn danger" style="padding:0.4rem 0.8rem; font-size:0.8rem;" onclick="window.revokeAdmin('${email}')">Revoke</button>
                        </div>
                    </div>`;
                });

                container.innerHTML = html || '<p style="color:#888;">No team admins assigned yet.</p>';
            } else {
                container.innerHTML = '<p style="color:#888;">No team admins assigned yet.</p>';
            }
        } catch (err) {
            console.error(err);
            container.innerHTML = `<p class="text-danger">Failed to load admin list.</p>`;
        }
    }
}
