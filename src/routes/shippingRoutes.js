const express = require('express');
const {
  SHIPPING_RATES,
  parseShippingOptions,
  isRemoteAddress,
  calculateShipping
} = require('../utils/shipping');

const router = express.Router();

/**
 * @openapi
 * /api/shipping/quote:
 *   post:
 *     summary: 試算運費（結帳頁即時顯示運費明細用）
 *     description: |
 *       依商品小計、配送方式、收件地址與是否當日急件試算運費，不建立任何資料。
 *       實際下單時 POST /api/orders 會以購物車內容在伺服器端重新計算，不採用此試算結果。
 *
 *       規則：宅配基本運費 120（商品小計滿 1500 免基本運費）；超商取貨 60（不是基本運費，滿額不免）；
 *       偏遠地區 +200（依地址判定離島）；當日急件 +250。附加費可疊加，不受滿額免運影響。
 *     tags: [Shipping]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [subtotal]
 *             properties:
 *               subtotal:
 *                 type: integer
 *                 minimum: 0
 *                 description: 商品小計
 *                 example: 1200
 *               shippingMethod:
 *                 type: string
 *                 enum: [home_delivery, cvs_pickup]
 *                 default: home_delivery
 *               isUrgent:
 *                 type: boolean
 *                 default: false
 *               recipientAddress:
 *                 type: string
 *                 description: 收件地址，用於判定是否為偏遠地區；未提供則視為非偏遠地區
 *                 example: 澎湖縣馬公市中正路 1 號
 *     responses:
 *       200:
 *         description: 試算成功
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data:
 *                   type: object
 *                   properties:
 *                     shipping_method:
 *                       type: string
 *                       enum: [home_delivery, cvs_pickup]
 *                     subtotal:
 *                       type: integer
 *                     delivery_fee:
 *                       type: integer
 *                       description: 配送方式費用（宅配 120 或滿額 0；超商取貨 60）
 *                     remote_area_fee:
 *                       type: integer
 *                       description: 偏遠地區附加費（0 或 200）
 *                     urgent_fee:
 *                       type: integer
 *                       description: 當日急件附加費（0 或 250）
 *                     shipping_fee:
 *                       type: integer
 *                       description: 運費合計
 *                     is_free_shipping:
 *                       type: boolean
 *                       description: 是否適用滿額免宅配基本運費
 *                     is_remote_area:
 *                       type: boolean
 *                     is_urgent:
 *                       type: boolean
 *                     total_amount:
 *                       type: integer
 *                       description: 商品小計 + 運費
 *                     free_shipping_threshold:
 *                       type: integer
 *                       description: 宅配免運門檻
 *                 error:
 *                   type: string
 *                   nullable: true
 *                 message:
 *                   type: string
 *             example:
 *               data:
 *                 shipping_method: home_delivery
 *                 subtotal: 1500
 *                 delivery_fee: 0
 *                 remote_area_fee: 200
 *                 urgent_fee: 250
 *                 shipping_fee: 450
 *                 is_free_shipping: true
 *                 is_remote_area: true
 *                 is_urgent: true
 *                 total_amount: 1950
 *                 free_shipping_threshold: 1500
 *               error: null
 *               message: 試算成功
 *       400:
 *         description: subtotal 不是非負整數，或 shippingMethod / isUrgent 不合法
 */
router.post('/quote', (req, res) => {
  const { subtotal, recipientAddress } = req.body;

  if (!Number.isInteger(subtotal) || subtotal < 0) {
    return res.status(400).json({
      data: null,
      error: 'VALIDATION_ERROR',
      message: 'subtotal 必須為非負整數'
    });
  }

  const shippingOptions = parseShippingOptions(req.body);
  if (shippingOptions.error) {
    return res.status(400).json({
      data: null,
      error: 'VALIDATION_ERROR',
      message: shippingOptions.error
    });
  }

  const result = calculateShipping({
    subtotal,
    ...shippingOptions.value,
    isRemoteArea: isRemoteAddress(recipientAddress)
  });

  res.json({
    data: {
      shipping_method: result.shippingMethod,
      subtotal: result.subtotal,
      delivery_fee: result.deliveryFee,
      remote_area_fee: result.remoteAreaFee,
      urgent_fee: result.urgentFee,
      shipping_fee: result.shippingFee,
      is_free_shipping: result.isFreeShipping,
      is_remote_area: result.isRemoteArea,
      is_urgent: result.isUrgent,
      total_amount: result.totalAmount,
      free_shipping_threshold: SHIPPING_RATES.FREE_SHIPPING_THRESHOLD
    },
    error: null,
    message: '試算成功'
  });
});

module.exports = router;
