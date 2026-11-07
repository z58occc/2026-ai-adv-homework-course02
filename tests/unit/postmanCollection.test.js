// Postman Collection 轉換器單元測試：以 swagger-jsdoc 即時產生 OpenAPI，不讀寫任何檔案
const swaggerJsdoc = require('swagger-jsdoc');
const swaggerOptions = require('../../swagger-config');
const { buildCollection, exampleFromSchema } = require('../../scripts/generate-postman');

const spec = swaggerJsdoc(swaggerOptions);
const collection = buildCollection(spec);
const requests = collection.item.flatMap((folder) => folder.item);
const findRequest = (method, rawUrl) =>
  requests.find((r) => r.request.method === method && r.request.url.raw.split('?')[0] === rawUrl);

describe('Postman Collection 轉換器', () => {
  it('輸出可序列化為有效 JSON，並使用 Collection v2.1 格式', () => {
    const roundTrip = JSON.parse(JSON.stringify(collection));
    expect(roundTrip).toEqual(collection);
    expect(collection.info.schema).toBe('https://schema.getpostman.com/json/collection/v2.1.0/collection.json');
  });

  it('包含 baseUrl（預設 http://localhost:3001）、token、sessionId 變數', () => {
    const vars = Object.fromEntries(collection.variable.map((v) => [v.key, v.value]));
    expect(vars.baseUrl).toBe('http://localhost:3001');
    expect(vars).toHaveProperty('token', '');
    expect(vars).toHaveProperty('sessionId', '');
  });

  it('OpenAPI 的每個操作都轉成一個請求，且網址皆以 {{baseUrl}} 開頭', () => {
    const operationCount = Object.values(spec.paths).reduce((n, item) => n + Object.keys(item).length, 0);
    expect(requests).toHaveLength(operationCount);
    for (const r of requests) {
      expect(r.request.url.raw.startsWith('{{baseUrl}}/api/')).toBe(true);
      expect(r.request.url.host).toEqual(['{{baseUrl}}']);
    }
  });

  it('集合層級使用 Bearer {{token}}；需要登入的 API 繼承，公開 API 為 noauth', () => {
    expect(collection.auth).toEqual({
      type: 'bearer',
      bearer: [{ key: 'token', value: '{{token}}', type: 'string' }],
    });

    expect(findRequest('POST', '{{baseUrl}}/api/orders').request.auth).toBeUndefined();
    expect(findRequest('GET', '{{baseUrl}}/api/auth/profile').request.auth).toBeUndefined();
    expect(findRequest('GET', '{{baseUrl}}/api/admin/orders').request.auth).toBeUndefined();

    expect(findRequest('POST', '{{baseUrl}}/api/auth/login').request.auth).toEqual({ type: 'noauth' });
    expect(findRequest('GET', '{{baseUrl}}/api/products').request.auth).toEqual({ type: 'noauth' });
    expect(findRequest('POST', '{{baseUrl}}/api/shipping/quote').request.auth).toEqual({ type: 'noauth' });
  });

  it('登入與註冊成功後自動把 JWT 存入 token', () => {
    for (const url of ['{{baseUrl}}/api/auth/login', '{{baseUrl}}/api/auth/register']) {
      const script = findRequest('POST', url).event.find((e) => e.listen === 'test').script.exec.join('\n');
      expect(script).toContain('json.data.token');
      expect(script).toContain("pm.collectionVariables.set('token'");
    }
  });

  it('購物車 API 帶 X-Session-Id: {{sessionId}}', () => {
    const cartRequests = requests.filter((r) => r.request.url.raw.startsWith('{{baseUrl}}/api/cart'));
    expect(cartRequests.length).toBeGreaterThan(0);
    for (const r of cartRequests) {
      expect(r.request.header).toContainEqual(expect.objectContaining({ key: 'X-Session-Id', value: '{{sessionId}}' }));
    }
  });

  it('路徑參數轉為 :param，並預設指向自動記錄的集合變數', () => {
    const detail = findRequest('GET', '{{baseUrl}}/api/orders/:id');
    expect(detail.request.url.path).toEqual(['api', 'orders', ':id']);
    expect(detail.request.url.variable).toEqual([expect.objectContaining({ key: 'id', value: '{{orderId}}' })]);
  });

  it('建立訂單的 request body 範例包含配送欄位', () => {
    const body = JSON.parse(findRequest('POST', '{{baseUrl}}/api/orders').request.body.raw);
    expect(body).toMatchObject({
      recipientName: expect.any(String),
      recipientEmail: expect.any(String),
      recipientAddress: expect.any(String),
      shippingMethod: 'home_delivery',
      isUrgent: false,
    });
  });

  describe('exampleFromSchema', () => {
    it('優先序：example → default → enum[0] → 型別預設值', () => {
      expect(exampleFromSchema({ type: 'string', example: 'a', default: 'b' })).toBe('a');
      expect(exampleFromSchema({ type: 'integer', default: 3 })).toBe(3);
      expect(exampleFromSchema({ type: 'string', enum: ['x', 'y'] })).toBe('x');
      expect(exampleFromSchema({ type: 'integer', minimum: 1 })).toBe(1);
      expect(exampleFromSchema({ type: 'boolean' })).toBe(false);
      expect(exampleFromSchema({ type: 'string', format: 'email' })).toBe('user@example.com');
      expect(exampleFromSchema({ type: 'object', properties: { n: { type: 'integer' } } })).toEqual({ n: 0 });
    });
  });
});
