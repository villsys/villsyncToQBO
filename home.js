import { db } from './auth.js'; 
import { doc, getDoc, setDoc } from "https://www.gstatic.com/firebasejs/12.11.0/firebase-firestore.js";
import { currentUser } from './app.js';

export default class Home {
    constructor() {
        this.userRole = 'guest'; 
    }

    async render() {
        return `
            <style>
                .hub-container { padding: 2rem; max-width: 1200px; margin: 0 auto; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; }
                .hub-header { text-align: center; margin-bottom: 3rem; }
                .hub-header h1 { color: #1F4E78; font-size: 2.5rem; margin-bottom: 0.5rem; }
                .hub-header p { color: #666; font-size: 1.1rem; }
                
                .card-grid { display: flex; flex-wrap: wrap; gap: 20px; justify-content: center; margin-bottom: 3rem; }
                
                /* Roughly 2 inches wide by 1 inch high minimum, expanding as needed */
                .tool-card { background: #fff; border: 1px solid #dee2e6; border-radius: 8px; width: 280px; min-height: 160px; padding: 1.5rem; box-shadow: 0 4px 10px rgba(0,0,0,0.05); transition: transform 0.2s, box-shadow 0.2s; display: flex; flex-direction: column; text-decoration: none; color: inherit; }
                .tool-card:hover { transform: translateY(-5px); box-shadow: 0 8px 15px rgba(0,0,0,0.1); border-color: #3498db; }
                .tool-card h3 { color: #2c3e50; margin-top: 0; margin-bottom: 0.5rem; font-size: 1.2rem; border-bottom: 2px solid #f8f9fa; padding-bottom: 0.5rem; }
                .tool-card .badge { display: inline-block; padding: 3px 8px; border-radius: 12px; font-size: 0.7rem; font-weight: bold; margin-bottom: 10px; }
                .badge-free { background: #e8f8f5; color: #27ae60; }
                .badge-pro { background: #fdf2e9; color: #e67e22; }
                .tool-card p { font-size: 0.85rem; color: #555; flex-grow: 1; margin-bottom: 1rem; line-height: 1.4; }
                .tool-card .guest-limits { background: #f8f9fa; padding: 8px; border-radius: 4px; font-size: 0.75rem; color: #7f8c8d; border-left: 3px solid #bdc3c7; }

                .admin-panel { background: #fff; border: 2px solid #8e44ad; border-radius: 8px; padding: 2rem; margin-top: 2rem; display: none; }
                .admin-panel h2 { color: #8e44ad; margin-top: 0; }
                .admin-form { display: flex; flex-direction: column; gap: 15px; background: #f8f9fa; padding: 1.5rem; border-radius: 6px; margin-bottom: 2rem; border: 1px solid #dee2e6; }
                .checkbox-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 10px; margin-top: 10px; }
                .checkbox-item { display: flex; align-items: center; gap: 8px; font-size: 0.9rem; color: #2c3e50; }
                .btn { padding: 8px 16px; border: none; border-radius: 4px; font-weight: bold; cursor: pointer; color: white; background: #8e44ad; transition: opacity 0.2s; }
                .btn:hover { opacity: 0.9; }
                .btn.danger { background: #e74c3c; }
            </style>

            <div class="hub-container">
                <div class="hub-header">
                    <h1>Welcome to VilSync</h1>
                    <p>Select an integration tool below to manage your QuickBooks Online data.</p>
                </div>

                <div class="card-grid">
                    <a href="#/amazon" class="tool-card">
                        <h3>Amazon Integrator</h3>
                        <div><span class="badge badge-pro">Data Push Module</span></div>
                        <p>Automatically synthesize and push Amazon Date Range Reports directly into QBO.</p>
                        <div class="guest-limits">
                            <strong>Guest Access:</strong> View maps & test parsing. Uploads truncated to 10 rows. Max 10 pushes/month.
                        </div>
                    </a>

                    <a href="#/shopify" class="tool-card">
                        <h3>Shopify Integrator</h3>
                        <div><span class="badge badge-pro">Data Push Module</span></div>
                        <p>Process Shopify Orders and Payouts, automatically extracting payment processor fees.</p>
                        <div class="guest-limits">
                            <strong>Guest Access:</strong> View maps & test parsing. Uploads truncated to 10 rows. Max 10 pushes/month.
                        </div>
                    </a>

                    <a href="#/productCostBuilder" class="tool-card">
                        <h3>Product Cost Builder</h3>
                        <div><span class="badge badge-free">Utility</span></div>
                        <p>Build Bill of Materials (BOM), calculate landed costs, and estimate wholesale pricing.</p>
                        <div class="guest-limits">
                            <strong>Guest Access:</strong> Full calculation access. Cannot push Journal/Adjustment entries to QBO.
                        </div>
                    </a>

                    <a href="#/bulkDeleteTransaction" class="tool-card">
                        <h3>Bulk Delete Utility</h3>
                        <div><span class="badge badge-pro">Admin Utility</span></div>
                        <p>Fetch live transactions directly from QBO and safely execute bulk permanent deletions.</p>
                        <div class="guest-limits">
                            <strong>Guest Access:</strong> Can fetch and view live QBO transactions. Deletion is strictly locked.
                        </div>
                    </a>
                </div>

                <div id="superAdminPanel" class="admin-panel">
                    <h2>⚙️ Super Admin Control Panel</h2>
                    <p style="color: #666; margin-bottom: 1.5rem;">Grant tool-specific admin privileges to your team members.</p>
                    
                    <div class="admin-form">
                        <label style="font-weight: bold; color: #2c3e50;">Assign New Admin:</label>
                        <input type="email" id="newAdminEmail" placeholder="colleague@gmail.com" style="padding: 0.6rem; border: 1px solid #ccc; border-radius: 4px; width: 100%; max-width: 400px;">
                        
                        <div>
                            <label style="font-weight: bold; font-size: 0.85rem; color: #666;">Select Authorized Tools:</label>
                            <div class="checkbox-grid">
                                <label class="checkbox-item"><input type="checkbox" class="tool-cb" value="amazon"> Amazon Integrator</label>
                                <label class="checkbox-item"><input type="checkbox" class="tool-cb" value="shopify"> Shopify Integrator</label>
                                <label class="checkbox-item"><input type="checkbox" class="tool-cb" value="productCost"> Product Cost Builder</label>
                                <label class="checkbox-item"><input type="checkbox" class="tool-cb" value="bulkDelete"> Bulk Delete Utility</label>
                            </div>
                        </div>
                        
                        <button class="btn" style="align-self: flex-start; margin-top: 10px;" onclick="window.saveAdmin()">Grant Access</button>
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
        
        // Super Admin verification (Hardcoded master email)
        if (currentUser.email === 'vnvcpas.excelimporter@gmail.com') {
            this.userRole = 'super_admin';
            document.getElementById('superAdminPanel').style.display = 'block';
            await this.loadAdminList();
        }

        window.saveAdmin = async () => {
            const email = document.getElementById('newAdminEmail').value.trim().toLowerCase();
            if (!email) return alert("Please enter a valid email address.");

            const selectedTools = [];
            document.querySelectorAll('.tool-cb:checked').forEach(cb => selectedTools.push(cb.value));

            if (selectedTools.length === 0) return alert("Please select at least one tool for this admin.");

            try {
                // We save the tools array inside the admin's email object
                await setDoc(doc(db, "global_config", "admins"), { 
                    [email]: { tools: selectedTools, addedAt: new Date().toISOString() } 
                }, { merge: true });
                
                alert(`Successfully granted access to ${email}!`);
                document.getElementById('newAdminEmail').value = '';
                document.querySelectorAll('.tool-cb').forEach(cb => cb.checked = false);
                await this.loadAdminList();
            } catch (e) {
                alert("Failed to save admin. " + e.message);
            }
        };

        window.revokeAdmin = async (email) => {
            if(!confirm(`Are you sure you want to completely revoke admin privileges for ${email}?`)) return;
            try {
                // Setting to false neutralizes the account
                await setDoc(doc(db, "global_config", "admins"), { [email]: false }, { merge: true });
                await this.loadAdminList();
            } catch (e) {
                alert("Failed to revoke admin. " + e.message);
            }
        };
    }

    async loadAdminList() {
        const container = document.getElementById('adminListContainer');
        try {
            const adminDoc = await getDoc(doc(db, "global_config", "admins"));
            if (adminDoc.exists()) {
                const data = adminDoc.data();
                let html = '';
                
                Object.keys(data).forEach(email => {
                    const adminData = data[email];
                    // Verify it's an active admin object with tools
                    if (adminData && typeof adminData === 'object' && adminData.tools && adminData.tools.length > 0) {
                        const badges = adminData.tools.map(t => `<span style="background:#e9ecef; padding:2px 6px; border-radius:4px; font-size:0.75rem; margin-right:5px; color:#34495e;">${t}</span>`).join('');
                        
                        html += `
                        <div style="display:flex; justify-content:space-between; align-items:center; padding:0.8rem 0; border-bottom:1px solid #f1f1f1;">
                            <div>
                                <div style="font-weight:bold; color:#2c3e50; margin-bottom:4px;">${email}</div>
                                <div>${badges}</div>
                            </div>
                            <button class="btn danger" style="padding:0.4rem 0.8rem; font-size:0.8rem;" onclick="window.revokeAdmin('${email}')">Revoke</button>
                        </div>`;
                    }
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
