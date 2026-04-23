import { httpsCallable } from "https://www.gstatic.com/firebasejs/12.11.0/firebase-functions.js";
import { db } from '../auth.js';
import { doc, getDoc, setDoc } from "https://www.gstatic.com/firebasejs/12.11.0/firebase-firestore.js";
import { currentUser } from '../app.js';

export async function pushShopifySalesReceipts(data, config, context) {
    const pushQboEntity = httpsCallable(config.functions, 'pushQboEntity');
    
    const orders = {};
    data.forEach(t => {
        if (!t.category) throw new Error("Missing category mapping in Sales.");
        const oId = t.orderId || t.uid; 
        const groupKey = oId;
        
        if (!orders[groupKey]) {
            orders[groupKey] = { 
                orderId: oId, 
                date: t.dateTime, 
                paymentMethod: t.mainTabGrouping,
                shipping: t.shipping || 0,
                taxes: t.taxes || 0,
                discount: t.discount || 0,
                lines: [] 
            };
        }
        orders[groupKey].lines.push(t);
    });

    let pushedIds = [];
    const totalLines = data.length;
    const totalTxns = Object.keys(orders).length;
    let txnsPushed = 0;
    let linesPushed = 0;
    const typeName = "shopify sales receipt";

    for (const [groupKey, orderData] of Object.entries(orders)) {
        const orderId = orderData.orderId;
        const customerName = `Shopify Customer (${orderData.paymentMethod})`;
        const txnDate = context.formatDateStr(orderData.date);
        const exactTimeMs = orderData.date ? new Date(orderData.date).getTime() : Date.now();

        let netAmount = 0;
        const qboLines = orderData.lines.map((line, index) => {
            const amt = line.totalAmount;
            netAmount += amt;
            return {
                "Id": (index + 1).toString(),
                "Description": line.description || line.lineItem,
                "Amount": amt, 
                "DetailType": "SalesItemLineDetail",
                "SalesItemLineDetail": {
                    "Qty": line.quantity,
                    "UnitPrice": line.rate, 
                    "ItemRef": {
                        "value": line.category, 
                        "name": (line.sku ? `${line.sku} - ${line.lineItem}` : line.lineItem).substring(0, 100) 
                    },
                    "_ItemSku": line.sku || "",
                    "_ItemDesc": line.description || line.lineItem
                }
            };
        });

        // Append Shipping, Tax, and Discount as distinct line items if they exist
        let lineIndex = qboLines.length + 1;
        if (orderData.shipping > 0) {
            qboLines.push({ "Id": (lineIndex++).toString(), "Description": "Shipping Collected", "Amount": orderData.shipping, "DetailType": "SalesItemLineDetail", "SalesItemLineDetail": { "Qty": 1, "UnitPrice": orderData.shipping, "ItemRef": { "name": "Shopify Shipping Income" }, "_ItemDesc": "Shipping" }});
            netAmount += orderData.shipping;
        }
        if (orderData.taxes > 0) {
            qboLines.push({ "Id": (lineIndex++).toString(), "Description": "Taxes Collected", "Amount": orderData.taxes, "DetailType": "SalesItemLineDetail", "SalesItemLineDetail": { "Qty": 1, "UnitPrice": orderData.taxes, "ItemRef": { "name": "Shopify Tax Liability" }, "_ItemDesc": "Tax" }});
            netAmount += orderData.taxes;
        }
        if (orderData.discount > 0) {
            qboLines.push({ "Id": (lineIndex++).toString(), "Description": "Order Discount", "Amount": -Math.abs(orderData.discount), "DetailType": "SalesItemLineDetail", "SalesItemLineDetail": { "Qty": 1, "UnitPrice": -Math.abs(orderData.discount), "ItemRef": { "name": "Shopify Discounts Given" }, "_ItemDesc": "Discount" }});
            netAmount -= orderData.discount;
        }

        const signature = `SHP_SALES_${exactTimeMs}_${orderId}_${netAmount.toFixed(2)}`;
        const ledgerRef = doc(db, "users", currentUser.uid, "qbo_sync_ledger", signature);
        const ledgerSnap = await getDoc(ledgerRef);
        
        if (ledgerSnap.exists()) {
            txnsPushed++;
            linesPushed += orderData.lines.length;
            if (context && context.updatePushProgress) context.updatePushProgress(linesPushed, txnsPushed, totalLines, totalTxns, typeName);
            continue; 
        }

        const payload = {
            "entityType": "SalesReceipt",
            "realmId": config.realmId,
            "data": {
                "DocNumber": orderId.substring(0, 21), 
                "TxnDate": txnDate,
                "CustomerRef": { "name": customerName }, 
                "DepositToAccountRef": { "name": config.depositAccountName },
                "PrivateNote": `Shopify Order: ${orderId} | Gateway: ${orderData.paymentMethod}`,
                "Line": qboLines
            }
        };

        const res = await pushQboEntity(payload);
        await setDoc(ledgerRef, { batchId: config.batchId, qboId: res.data.qboResponseId, timestamp: new Date().toISOString() });
        pushedIds.push({ type: "SalesReceipt", id: res.data.qboResponseId });

        txnsPushed++;
        linesPushed += orderData.lines.length;
        if (context && context.updatePushProgress) context.updatePushProgress(linesPushed, txnsPushed, totalLines, totalTxns, typeName);
    }
    
    return pushedIds;
}
