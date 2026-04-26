import { httpsCallable } from "https://www.gstatic.com/firebasejs/12.11.0/firebase-functions.js";
import { db } from '../auth.js';
import { doc, getDoc, setDoc } from "https://www.gstatic.com/firebasejs/12.11.0/firebase-firestore.js";
import { currentUser } from '../app.js';

export async function pushShopifyPayouts(data, config, context) {
    const pushQboEntity = httpsCallable(config.functions, 'pushQboEntity');

    let pushedIds = [];
    const totalLines = data.length;
    const totalTxns = data.length;
    let txnsPushed = 0;
    let linesPushed = 0;
    const typeName = "shopify payout transfer";

    for (const t of data) {
        if (!t.category) throw new Error("Missing category mapping in Payouts.");
        
        const txnDate = context.formatDateStr(t.dateTime);
        const exactTimeMs = t.dateTime ? new Date(t.dateTime).getTime() : Date.now();
        const amt = Math.abs(t.totalAmount);

        const signature = `SHP_PAYOUT_${exactTimeMs}_${t.settlementId}_${amt.toFixed(2)}`;
        // const ledgerRef = doc(db, "users", currentUser.uid, "qbo_sync_ledger", signature);
        const ledgerRef = doc(db, "qbo_companies", config.realmId, "qbo_sync_ledger", signature);
        const ledgerSnap = await getDoc(ledgerRef);
        
        if (ledgerSnap.exists()) {
            txnsPushed++;
            linesPushed++;
            if (context && context.updatePushProgress) context.updatePushProgress(linesPushed, txnsPushed, totalLines, totalTxns, typeName);
            continue; 
        }

        const payload = {
            "entityType": "Purchase",
            "realmId": config.realmId,
            "data": {
                "TxnDate": txnDate,
                "PaymentType": "Cash",
                "AccountRef": { "name": config.depositAccountName }, 
                "EntityRef": { "name": "Shopify Payments" },
                "PrivateNote": `Transfer ID: ${t.settlementId || 'N/A'}`,
                "Line": [{
                    "Amount": amt,
                    "DetailType": "AccountBasedExpenseLineDetail",
                    "AccountBasedExpenseLineDetail": { "AccountRef": { "name": t.category } },
                    "Description": t.description || t.lineItem
                }]
            }
        };

        const res = await pushQboEntity(payload);
        await setDoc(ledgerRef, { batchId: config.batchId, qboId: res.data.qboResponseId, timestamp: new Date().toISOString() });
        pushedIds.push({ type: "Purchase", id: res.data.qboResponseId });

        txnsPushed++;
        linesPushed++;
        if (context && context.updatePushProgress) context.updatePushProgress(linesPushed, txnsPushed, totalLines, totalTxns, typeName);
    }
    return pushedIds;
}
