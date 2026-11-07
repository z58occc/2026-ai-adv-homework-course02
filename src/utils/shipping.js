/**
 * Shipping 模組：集中處理配送方式、滿額免運、偏遠地區與當日急件的運費計算。
 *
 * 本模組為純函式、無外部依賴（不存取 DB、不讀 req），可獨立單元測試。
 * 運費規則調整時只需修改此檔案。
 *
 * 計算規則：
 *   運費     = 配送方式費用 + 偏遠地區附加費 + 當日急件附加費
 *   訂單總額 = 商品小計 + 運費
 *
 *   - 宅配：基本運費 120；商品小計 ≥ 1,500 免基本運費
 *   - 超商取貨：60（不是基本運費，滿額不免除）
 *   - 附加費彼此獨立、可疊加，不受配送方式或滿額免運影響
 */

const SHIPPING_METHODS = Object.freeze({
  HOME_DELIVERY: 'home_delivery',
  CVS_PICKUP: 'cvs_pickup',
});

const SHIPPING_RATES = Object.freeze({
  HOME_DELIVERY_FEE: 120,         // 宅配基本運費
  CVS_PICKUP_FEE: 60,             // 超商取貨費（非基本運費，滿額不免）
  FREE_SHIPPING_THRESHOLD: 1500,  // 商品小計達此金額，免宅配基本運費
  REMOTE_AREA_SURCHARGE: 200,     // 偏遠地區附加費
  URGENT_SURCHARGE: 250,          // 當日急件附加費
});

/**
 * 偏遠地區（離島）判定清單：收件地址包含任一名稱即視為偏遠地區。
 * 刻意使用完整的縣／鄉鎮名稱，避免「台北市金門街」這類以地名命名的街道被誤判。
 */
const REMOTE_AREA_KEYWORDS = Object.freeze([
  // 縣級
  '澎湖縣', '金門縣', '連江縣',
  // 澎湖縣
  '馬公市', '湖西鄉', '白沙鄉', '西嶼鄉', '望安鄉', '七美鄉',
  // 金門縣
  '金城鎮', '金湖鎮', '金沙鎮', '金寧鄉', '烈嶼鄉', '烏坵鄉',
  // 連江縣（馬祖）
  '南竿鄉', '北竿鄉', '莒光鄉', '東引鄉',
  // 臺東縣
  '綠島鄉', '蘭嶼鄉',
  // 屏東縣
  '琉球鄉',
]);

const VALID_METHODS = Object.values(SHIPPING_METHODS);

function isValidShippingMethod(method) {
  return VALID_METHODS.includes(method);
}

/**
 * 依收件地址判定是否為偏遠地區。非字串一律視為非偏遠地區。
 * @param {string} address
 * @returns {boolean}
 */
function isRemoteAddress(address) {
  if (typeof address !== 'string') return false;
  const normalized = address.replace(/\s+/g, '');
  return REMOTE_AREA_KEYWORDS.some((keyword) => normalized.includes(keyword));
}

/**
 * 驗證使用者可選的配送選項並套用預設值（供路由層驗證 request body 使用）。
 * 未提供（undefined / null）時：shippingMethod 預設宅配、isUrgent 預設 false。
 *
 * @param {{ shippingMethod?: string, isUrgent?: boolean }} options
 * @returns {{ value: { shippingMethod: string, isUrgent: boolean } } | { error: string }}
 */
function parseShippingOptions({ shippingMethod, isUrgent } = {}) {
  const method = shippingMethod ?? SHIPPING_METHODS.HOME_DELIVERY;
  if (!isValidShippingMethod(method)) {
    return { error: `配送方式必須為 ${VALID_METHODS.join(' 或 ')}` };
  }

  const urgent = isUrgent ?? false;
  if (typeof urgent !== 'boolean') {
    return { error: 'isUrgent 必須為布林值' };
  }

  return { value: { shippingMethod: method, isUrgent: urgent } };
}

/**
 * 計算運費明細。
 *
 * @param {object} params
 * @param {number}  params.subtotal                      商品小計（非負整數）
 * @param {string}  [params.shippingMethod='home_delivery'] 配送方式
 * @param {boolean} [params.isRemoteArea=false]          是否偏遠地區
 * @param {boolean} [params.isUrgent=false]              是否當日急件
 * @returns {{
 *   shippingMethod: string,
 *   subtotal: number,
 *   deliveryFee: number,
 *   remoteAreaFee: number,
 *   urgentFee: number,
 *   shippingFee: number,
 *   isFreeShipping: boolean,
 *   isRemoteArea: boolean,
 *   isUrgent: boolean,
 *   totalAmount: number
 * }}
 * @throws {TypeError} 參數不合法時（屬程式錯誤，路由層應先以 parseShippingOptions 驗證）
 */
function calculateShipping({
  subtotal,
  shippingMethod = SHIPPING_METHODS.HOME_DELIVERY,
  isRemoteArea = false,
  isUrgent = false,
} = {}) {
  if (!Number.isInteger(subtotal) || subtotal < 0) {
    throw new TypeError('subtotal 必須為非負整數');
  }
  if (!isValidShippingMethod(shippingMethod)) {
    throw new TypeError(`不支援的配送方式：${shippingMethod}`);
  }
  if (typeof isRemoteArea !== 'boolean' || typeof isUrgent !== 'boolean') {
    throw new TypeError('isRemoteArea 與 isUrgent 必須為布林值');
  }

  // 滿額免運只免除「宅配基本運費」；超商取貨費不是基本運費，不受影響
  const isFreeShipping =
    shippingMethod === SHIPPING_METHODS.HOME_DELIVERY &&
    subtotal >= SHIPPING_RATES.FREE_SHIPPING_THRESHOLD;

  let deliveryFee;
  if (shippingMethod === SHIPPING_METHODS.CVS_PICKUP) {
    deliveryFee = SHIPPING_RATES.CVS_PICKUP_FEE;
  } else {
    deliveryFee = isFreeShipping ? 0 : SHIPPING_RATES.HOME_DELIVERY_FEE;
  }

  const remoteAreaFee = isRemoteArea ? SHIPPING_RATES.REMOTE_AREA_SURCHARGE : 0;
  const urgentFee = isUrgent ? SHIPPING_RATES.URGENT_SURCHARGE : 0;
  const shippingFee = deliveryFee + remoteAreaFee + urgentFee;

  return {
    shippingMethod,
    subtotal,
    deliveryFee,
    remoteAreaFee,
    urgentFee,
    shippingFee,
    isFreeShipping,
    isRemoteArea,
    isUrgent,
    totalAmount: subtotal + shippingFee,
  };
}

module.exports = {
  SHIPPING_METHODS,
  SHIPPING_RATES,
  REMOTE_AREA_KEYWORDS,
  isValidShippingMethod,
  isRemoteAddress,
  parseShippingOptions,
  calculateShipping,
};
