// Shipping 模組單元測試：純函式，不啟動 app、不碰資料庫
const {
  SHIPPING_METHODS,
  SHIPPING_RATES,
  isValidShippingMethod,
  isRemoteAddress,
  parseShippingOptions,
  calculateShipping,
} = require('../src/utils/shipping');

const { HOME_DELIVERY, CVS_PICKUP } = SHIPPING_METHODS;

describe('Shipping 模組', () => {
  describe('費率常數', () => {
    it('應符合規格：宅配 120、超商 60、免運門檻 1500、偏遠 +200、急件 +250', () => {
      expect(SHIPPING_RATES).toEqual({
        HOME_DELIVERY_FEE: 120,
        CVS_PICKUP_FEE: 60,
        FREE_SHIPPING_THRESHOLD: 1500,
        REMOTE_AREA_SURCHARGE: 200,
        URGENT_SURCHARGE: 250,
      });
    });
  });

  describe('calculateShipping', () => {
    it('宅配基本運費：小計未達門檻收 120 元', () => {
      const result = calculateShipping({ subtotal: 1000, shippingMethod: HOME_DELIVERY });

      expect(result).toEqual({
        shippingMethod: HOME_DELIVERY,
        subtotal: 1000,
        deliveryFee: 120,
        remoteAreaFee: 0,
        urgentFee: 0,
        shippingFee: 120,
        isFreeShipping: false,
        isRemoteArea: false,
        isUrgent: false,
        totalAmount: 1120,
      });
    });

    it('超商取貨費用：收 60 元', () => {
      const result = calculateShipping({ subtotal: 1000, shippingMethod: CVS_PICKUP });

      expect(result.deliveryFee).toBe(60);
      expect(result.shippingFee).toBe(60);
      expect(result.isFreeShipping).toBe(false);
      expect(result.totalAmount).toBe(1060);
    });

    it('商品小計 1,499 元：差 1 元未達免運，仍收宅配基本運費 120 元', () => {
      const result = calculateShipping({ subtotal: 1499, shippingMethod: HOME_DELIVERY });

      expect(result.isFreeShipping).toBe(false);
      expect(result.deliveryFee).toBe(120);
      expect(result.shippingFee).toBe(120);
      expect(result.totalAmount).toBe(1619);
    });

    it('商品小計 1,500 元：剛好達門檻，免宅配基本運費', () => {
      const result = calculateShipping({ subtotal: 1500, shippingMethod: HOME_DELIVERY });

      expect(result.isFreeShipping).toBe(true);
      expect(result.deliveryFee).toBe(0);
      expect(result.shippingFee).toBe(0);
      expect(result.totalAmount).toBe(1500);
    });

    it('偏遠地區附加費：加收 200 元', () => {
      const result = calculateShipping({
        subtotal: 1000,
        shippingMethod: HOME_DELIVERY,
        isRemoteArea: true,
      });

      expect(result.deliveryFee).toBe(120);
      expect(result.remoteAreaFee).toBe(200);
      expect(result.urgentFee).toBe(0);
      expect(result.shippingFee).toBe(320);
      expect(result.totalAmount).toBe(1320);
    });

    it('當日急件附加費：加收 250 元', () => {
      const result = calculateShipping({
        subtotal: 1000,
        shippingMethod: HOME_DELIVERY,
        isUrgent: true,
      });

      expect(result.deliveryFee).toBe(120);
      expect(result.remoteAreaFee).toBe(0);
      expect(result.urgentFee).toBe(250);
      expect(result.shippingFee).toBe(370);
      expect(result.totalAmount).toBe(1370);
    });

    it('多項附加費同時成立：宅配 + 偏遠地區 + 當日急件 = 120 + 200 + 250', () => {
      const result = calculateShipping({
        subtotal: 1000,
        shippingMethod: HOME_DELIVERY,
        isRemoteArea: true,
        isUrgent: true,
      });

      expect(result.deliveryFee).toBe(120);
      expect(result.remoteAreaFee).toBe(200);
      expect(result.urgentFee).toBe(250);
      expect(result.shippingFee).toBe(570);
      expect(result.totalAmount).toBe(1570);
    });

    it('多項附加費同時成立：超商取貨 + 偏遠地區 + 當日急件 = 60 + 200 + 250', () => {
      const result = calculateShipping({
        subtotal: 1000,
        shippingMethod: CVS_PICKUP,
        isRemoteArea: true,
        isUrgent: true,
      });

      expect(result.shippingFee).toBe(510);
      expect(result.totalAmount).toBe(1510);
    });

    it('滿額免運與附加費同時成立：只免基本運費，偏遠與急件附加費照收', () => {
      const result = calculateShipping({
        subtotal: 1500,
        shippingMethod: HOME_DELIVERY,
        isRemoteArea: true,
        isUrgent: true,
      });

      expect(result.isFreeShipping).toBe(true);
      expect(result.deliveryFee).toBe(0);
      expect(result.remoteAreaFee).toBe(200);
      expect(result.urgentFee).toBe(250);
      expect(result.shippingFee).toBe(450);
      expect(result.totalAmount).toBe(1950);
    });

    it('滿額免運與單一附加費同時成立：只收偏遠地區 200 元', () => {
      const result = calculateShipping({
        subtotal: 2000,
        shippingMethod: HOME_DELIVERY,
        isRemoteArea: true,
      });

      expect(result.shippingFee).toBe(200);
      expect(result.totalAmount).toBe(2200);
    });

    it('超商取貨不是基本運費：小計滿 1,500 元仍收 60 元', () => {
      const result = calculateShipping({ subtotal: 1500, shippingMethod: CVS_PICKUP });

      expect(result.isFreeShipping).toBe(false);
      expect(result.deliveryFee).toBe(60);
      expect(result.shippingFee).toBe(60);
      expect(result.totalAmount).toBe(1560);
    });

    it('未指定配送方式時預設為宅配', () => {
      const result = calculateShipping({ subtotal: 800 });

      expect(result.shippingMethod).toBe(HOME_DELIVERY);
      expect(result.shippingFee).toBe(120);
    });

    it('商品小計為 0 時仍收宅配基本運費', () => {
      expect(calculateShipping({ subtotal: 0 }).shippingFee).toBe(120);
    });

    it.each([
      ['負數', -1],
      ['小數', 100.5],
      ['字串', '1500'],
      ['未提供', undefined],
    ])('subtotal 為%s時拋出 TypeError', (_label, subtotal) => {
      expect(() => calculateShipping({ subtotal })).toThrow(TypeError);
    });

    it('不支援的配送方式拋出 TypeError', () => {
      expect(() => calculateShipping({ subtotal: 1000, shippingMethod: 'drone' })).toThrow(TypeError);
    });

    it('附加費旗標不是布林值時拋出 TypeError（避免 "false" 字串被當成 true）', () => {
      expect(() => calculateShipping({ subtotal: 1000, isRemoteArea: 'false' })).toThrow(TypeError);
      expect(() => calculateShipping({ subtotal: 1000, isUrgent: 1 })).toThrow(TypeError);
    });
  });

  describe('isRemoteAddress', () => {
    it.each([
      '澎湖縣馬公市中正路 1 號',
      '金門縣金城鎮民生路 2 號',
      '連江縣南竿鄉介壽村 3 號',
      '臺東縣綠島鄉南寮村 4 號',
      '台東縣蘭嶼鄉紅頭村 5 號',
      '屏東縣琉球鄉中山路 6 號',
      '880 馬公市光復路 7 號',
    ])('離島地址判定為偏遠地區：%s', (address) => {
      expect(isRemoteAddress(address)).toBe(true);
    });

    it('地址中夾雜空白仍可判定', () => {
      expect(isRemoteAddress('澎湖 縣 白沙鄉')).toBe(true);
    });

    it.each([
      '台北市大安區忠孝東路四段 1 號',
      '台北市中正區金門街 10 號',
      '新北市土城區金城路二段 5 號',
      '台北市內湖區金湖路 8 號',
    ])('本島地址（含以離島命名的街道）不判定為偏遠地區：%s', (address) => {
      expect(isRemoteAddress(address)).toBe(false);
    });

    it('非字串輸入視為非偏遠地區', () => {
      expect(isRemoteAddress(undefined)).toBe(false);
      expect(isRemoteAddress(null)).toBe(false);
      expect(isRemoteAddress(123)).toBe(false);
    });
  });

  describe('isValidShippingMethod', () => {
    it('只接受 home_delivery 與 cvs_pickup', () => {
      expect(isValidShippingMethod('home_delivery')).toBe(true);
      expect(isValidShippingMethod('cvs_pickup')).toBe(true);
      expect(isValidShippingMethod('HOME_DELIVERY')).toBe(false);
      expect(isValidShippingMethod(undefined)).toBe(false);
    });
  });

  describe('parseShippingOptions', () => {
    it('未提供時套用預設值：宅配、非急件', () => {
      expect(parseShippingOptions({})).toEqual({
        value: { shippingMethod: HOME_DELIVERY, isUrgent: false },
      });
      expect(parseShippingOptions({ shippingMethod: null, isUrgent: null })).toEqual({
        value: { shippingMethod: HOME_DELIVERY, isUrgent: false },
      });
    });

    it('保留合法的使用者選項', () => {
      expect(parseShippingOptions({ shippingMethod: CVS_PICKUP, isUrgent: true })).toEqual({
        value: { shippingMethod: CVS_PICKUP, isUrgent: true },
      });
    });

    it('配送方式不合法時回傳錯誤訊息', () => {
      const result = parseShippingOptions({ shippingMethod: 'express' });
      expect(result.error).toMatch(/配送方式/);
      expect(result.value).toBeUndefined();
    });

    it('isUrgent 不是布林值時回傳錯誤訊息', () => {
      const result = parseShippingOptions({ isUrgent: 'true' });
      expect(result.error).toMatch(/isUrgent/);
    });
  });
});
