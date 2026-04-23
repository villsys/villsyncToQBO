import { httpsCallable } from "https://www.gstatic.com/firebasejs/12.11.0/firebase-functions.js";
import { db } from '../auth.js';
import { doc, getDoc, setDoc } from "https://www.gstatic.com/firebasejs/12.11.0/firebase-firestore.js";
import { currentUser } from '../app.js';

export async function pushShopifyRefunds(data, config, context) {
    const pushQboEntity = httpsCallable(config.functions, 'pushQboEntity');
    const refunds = {};
    data.forEach(t => {
        if (!t.category) throw new Error("Missing category mapping in Refunds.");
        const oId = t.orderId || t.uid;
        const groupKey = t.settlementId || oId; // Group by Payout ID if available

        if (!refunds[groupKey]) refunds[groupKey] = { orderId: oId, settlementId: t.settlementId, date: t.dateTime, lines: [] };
        refunds[groupKey].lines.push(t);
    });

    let pushedIds = [];
    const totalLines = data.length;
    const totalTxns = Object.keys(refunds).length;
    let txnsPushed = 0;
    let linesPushed = 0;
    const typeName = "shopify refund";

    for (const [groupKey, refundData] of Object.entries(refunds)) {
        const orderId = refundData.orderId;
        const customerName = `Shopify Customer`;
        const txnDate = context.formatDateStr(refundData.date);
        const exactTimeMs = refundData.date ? new Date(refundData.date).getTime() : Date.now();

        let netAmount = 0;
        const qboLines = refundData.lines.map((line, index) => {
            const amt = Math.abs(line.totalAmount); 
            netAmount += amt;
            return {
                "Id": (index + 1).toString(),
                "Description": line.description || line.lineItem,
                "Amount": amt,
                "DetailType": "SalesItemLineDetail",
                "SalesItemLineDetail": {
                    "Qty": line.quantity || 1,
                    "UnitPrice": amt / (line.quantity || 1),
                    "ItemRef": { "value": line.category, "name": (line.sku ? `${line.sku} - ${line.lineItem}` : line.lineItem).substring(0, 100) },
                    "_ItemSku": line.sku || "",
                    "_ItemDesc": line.description || line.lineItem
                }
            };
        });

        const signature = `SHP_REFUND_${exactTimeMs}_${refundData.settlementId}_${netAmount.toFixed(2)}`;
        const ledgerRef = doc(db, "users", currentUser.uid, "qbo_sync_ledger", signature);
        const ledgerSnap = await getDoc(ledgerRef);
        
        if (ledgerSnap.exists()) {
            txnsPushed++;
            linesPushed += refundData.lines.length;
            if (context && context.updatePushProgress) context.updatePushProgress(linesPushed, txnsPushed, totalLines, totalTxns, typeName);
            continue; 
        }

        const payload = {
            "entityType": "RefundReceipt",
            "realmId": config.realmId,
            "data": {
                "DocNumber": orderId.substring(0, 21),
                "TxnDate": txnDate,
                "CustomerRef": { "name": customerName },
                "DepositToAccountRef": { "name": config.depositAccountName },
                "PrivateNote": `Refund for Shopify Order: ${orderId} | Payout ID: ${refundData.settlementId}`,
                "Line": qboLines
            }
        };

        const res = await pushQboEntity(payload);
        await setDoc(ledgerRef, { batchId: config.batchId, qboId: res.data.qboResponseId, timestamp: new Date().toISOString() });
        pushedIds.push({ type: "RefundReceipt", id: res.data.qboResponseId });

        txnsPushed++;
        linesPushed += refundData.lines.length;
        if (context && context.updatePushProgress) context.updatePushProgress(linesPushed, txnsPushed, totalLines, totalTxns, typeName);
    }
    return pushedIds;
}
