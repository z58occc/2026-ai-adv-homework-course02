#!/usr/bin/env node
/**
 * 將 openapi.json 轉換為 Postman Collection v2.1。
 *
 * 用法：npm run postman（會先執行 npm run openapi 產生最新的 openapi.json）
 * 輸出：postman/flower-shop.postman_collection.json
 *
 * 產出的 Collection：
 * - 所有 URL 使用 {{baseUrl}}（預設 http://localhost:3001）
 * - 變數：baseUrl、token、sessionId，以及串接流程用的 productId / cartItemId / orderId
 * - 集合層級 Bearer 認證（{{token}}）；需要 bearerAuth 的 API 直接繼承，公開 API 設為 noauth
 * - 登入／註冊成功後自動把 JWT 存進 token；購物車 API 附帶 X-Session-Id: {{sessionId}}
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const OPENAPI_PATH = path.join(ROOT, 'openapi.json');
const OUTPUT_PATH = path.join(ROOT, 'postman', 'flower-shop.postman_collection.json');
const DEFAULT_BASE_URL = 'http://localhost:3001';
const SCHEMA_URL = 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json';

// 資料夾排列順序（依實際操作流程）；未列出的 tag 依出現順序排在最後
const TAG_ORDER = ['Auth', 'Products', 'Cart', 'Shipping', 'Orders', 'Admin Products', 'Admin Orders'];

// 路徑參數預設值：指向由其他請求自動填入的集合變數
const PATH_PARAM_DEFAULTS = {
  '/api/products/{id}': { id: '{{productId}}' },
  '/api/admin/products/{id}': { id: '{{productId}}' },
  '/api/cart/{itemId}': { itemId: '{{cartItemId}}' },
  '/api/orders/{id}': { id: '{{orderId}}' },
  '/api/orders/{id}/pay': { id: '{{orderId}}' },
  '/api/orders/{id}/check-payment': { id: '{{orderId}}' },
  '/api/admin/orders/{id}': { id: '{{orderId}}' },
};

// Request body 中改用集合變數的欄位
const BODY_FIELD_VARIABLES = { productId: '{{productId}}' };

// 回應成功後要存入集合變數的欄位：'METHOD path' → [[變數, 取值運算式]]
const CAPTURES = {
  'POST /api/auth/login': [['token', 'json.data.token']],
  'POST /api/auth/register': [['token', 'json.data.token']],
  'GET /api/products': [['productId', 'json.data.products[0] && json.data.products[0].id']],
  'POST /api/cart': [['cartItemId', 'json.data.id']],
  'POST /api/orders': [['orderId', 'json.data.id']],
};

const COLLECTION_PREREQUEST = [
  '// 訪客購物車需要 X-Session-Id：尚未設定時自動產生一組',
  "if (!pm.collectionVariables.get('sessionId')) {",
  "  pm.collectionVariables.set('sessionId', pm.variables.replaceIn('{{$guid}}'));",
  '}',
];

const COLLECTION_TEST = [
  "pm.test('回應為 { data, error, message } 統一格式', function () {",
  '  const json = pm.response.json();',
  "  pm.expect(json).to.have.all.keys('data', 'error', 'message');",
  '});',
];

/** 依 JSON Schema 產生範例值：example → default → enum[0] → 依型別給預設值。 */
function exampleFromSchema(schema = {}) {
  if (schema.example !== undefined) return schema.example;
  if (schema.default !== undefined) return schema.default;
  if (Array.isArray(schema.enum) && schema.enum.length > 0) return schema.enum[0];

  switch (schema.type) {
    case 'object': {
      const result = {};
      for (const [key, prop] of Object.entries(schema.properties || {})) {
        result[key] = exampleFromSchema(prop);
      }
      return result;
    }
    case 'array':
      return [exampleFromSchema(schema.items)];
    case 'integer':
    case 'number':
      return schema.minimum !== undefined ? schema.minimum : 0;
    case 'boolean':
      return false;
    case 'string':
      return schema.format === 'email' ? 'user@example.com' : '';
    default:
      return null;
  }
}

function buildBody(operation) {
  const schema = operation.requestBody?.content?.['application/json']?.schema;
  if (!schema) return undefined;

  const example = exampleFromSchema(schema);
  if (example && typeof example === 'object' && !Array.isArray(example)) {
    for (const [field, variable] of Object.entries(BODY_FIELD_VARIABLES)) {
      if (field in example) example[field] = variable;
    }
  }

  return {
    mode: 'raw',
    raw: JSON.stringify(example, null, 2),
    options: { raw: { language: 'json' } },
  };
}

function buildUrl(pathKey, operation) {
  const segments = pathKey.replace(/^\//, '').split('/').map((s) => s.replace(/^\{(.+)\}$/, ':$1'));
  const params = operation.parameters || [];
  const defaults = PATH_PARAM_DEFAULTS[pathKey] || {};

  const url = {
    raw: `{{baseUrl}}/${segments.join('/')}`,
    host: ['{{baseUrl}}'],
    path: segments,
  };

  const pathParams = params.filter((p) => p.in === 'path');
  if (pathParams.length > 0) {
    url.variable = pathParams.map((p) => ({
      key: p.name,
      value: defaults[p.name] || '',
      description: p.description || `${p.name}（路徑參數）`,
    }));
  }

  const queryParams = params.filter((p) => p.in === 'query');
  if (queryParams.length > 0) {
    url.query = queryParams.map((p) => {
      const value = exampleFromSchema(p.schema);
      return {
        key: p.name,
        value: value === null || value === undefined ? '' : String(value),
        description: p.description || (p.schema?.enum ? `可選值：${p.schema.enum.join(' / ')}` : undefined),
        disabled: !p.required,
      };
    });
    url.raw += `?${url.query.filter((q) => !q.disabled).map((q) => `${q.key}=${q.value}`).join('&')}`.replace(/\?$/, '');
  }

  return url;
}

function securitySchemes(operation) {
  return new Set((operation.security || []).flatMap((s) => Object.keys(s)));
}

function buildRequestItem(pathKey, method, operation) {
  const schemes = securitySchemes(operation);
  const header = [];
  const body = buildBody(operation);
  if (body) header.push({ key: 'Content-Type', value: 'application/json' });
  if (schemes.has('sessionId')) {
    header.push({
      key: 'X-Session-Id',
      value: '{{sessionId}}',
      description: '訪客購物車識別；已登入時以 Bearer Token 為準',
    });
  }

  const request = {
    method: method.toUpperCase(),
    header,
    url: buildUrl(pathKey, operation),
    description: [operation.summary, operation.description].filter(Boolean).join('\n\n'),
  };
  if (body) request.body = body;
  // 未要求 bearerAuth 的 API 不送 Token；其餘繼承集合層級的 Bearer {{token}}
  if (!schemes.has('bearerAuth')) request.auth = { type: 'noauth' };

  const item = { name: operation.summary || `${method.toUpperCase()} ${pathKey}`, request, response: [] };

  const captureKey = `${method.toUpperCase()} ${pathKey}`;
  const captures = CAPTURES[captureKey];
  if (captures) {
    item.event = [
      {
        listen: 'test',
        script: {
          type: 'text/javascript',
          exec: [
            "pm.test('狀態碼為 2xx', function () { pm.response.to.be.success; });",
            'if (pm.response.code >= 200 && pm.response.code < 300) {',
            '  const json = pm.response.json();',
            ...captures.flatMap(([variable, expr]) => [
              `  const ${variable}Value = ${expr};`,
              `  if (${variable}Value) pm.collectionVariables.set('${variable}', ${variable}Value);`,
            ]),
            '}',
          ],
        },
      },
    ];
  }

  return item;
}

/**
 * 將 OpenAPI 3 文件轉換為 Postman Collection v2.1 物件。
 * @param {object} spec OpenAPI 文件
 * @param {{ baseUrl?: string }} [options]
 */
function buildCollection(spec, { baseUrl = DEFAULT_BASE_URL } = {}) {
  const folders = new Map();

  for (const [pathKey, pathItem] of Object.entries(spec.paths || {})) {
    for (const [method, operation] of Object.entries(pathItem)) {
      if (!['get', 'post', 'put', 'patch', 'delete'].includes(method)) continue;
      const tag = (operation.tags && operation.tags[0]) || 'Other';
      if (!folders.has(tag)) folders.set(tag, []);
      folders.get(tag).push(buildRequestItem(pathKey, method, operation));
    }
  }

  const rank = (tag) => (TAG_ORDER.includes(tag) ? TAG_ORDER.indexOf(tag) : TAG_ORDER.length);
  const tags = [...folders.keys()].sort((a, b) => rank(a) - rank(b));

  return {
    info: {
      name: spec.info?.title || 'API',
      description: [
        spec.info?.description,
        '',
        '使用方式：先執行 Auth › 登入（或註冊），成功後 JWT 會自動存入 {{token}}，需要登入的 API 會自動帶 Bearer Token。',
        'Products › 商品列表、Cart › 加入購物車、Orders › 建立訂單會自動記錄 productId / cartItemId / orderId 供後續請求使用。',
        '此檔由 scripts/generate-postman.js 依 openapi.json 產生，請勿手動修改，改完 JSDoc 後執行 npm run postman。',
      ].join('\n'),
      version: spec.info?.version,
      schema: SCHEMA_URL,
    },
    auth: {
      type: 'bearer',
      bearer: [{ key: 'token', value: '{{token}}', type: 'string' }],
    },
    event: [
      { listen: 'prerequest', script: { type: 'text/javascript', exec: COLLECTION_PREREQUEST } },
      { listen: 'test', script: { type: 'text/javascript', exec: COLLECTION_TEST } },
    ],
    variable: [
      { key: 'baseUrl', value: baseUrl, type: 'string', description: 'API 伺服器網址' },
      { key: 'token', value: '', type: 'string', description: 'JWT，登入／註冊成功後自動填入' },
      { key: 'sessionId', value: '', type: 'string', description: '訪客購物車 X-Session-Id，未設定時自動產生' },
      { key: 'productId', value: '', type: 'string', description: '商品列表回應的第一筆商品 ID' },
      { key: 'cartItemId', value: '', type: 'string', description: '最近一次加入購物車的品項 ID' },
      { key: 'orderId', value: '', type: 'string', description: '最近一次建立的訂單 ID' },
    ],
    item: tags.map((tag) => ({ name: tag, item: folders.get(tag) })),
  };
}

function main() {
  if (!fs.existsSync(OPENAPI_PATH)) {
    console.error('找不到 openapi.json，請先執行 npm run openapi（npm run postman 會自動執行）');
    process.exit(1);
  }

  const spec = JSON.parse(fs.readFileSync(OPENAPI_PATH, 'utf8'));
  const collection = buildCollection(spec, { baseUrl: process.env.POSTMAN_BASE_URL || DEFAULT_BASE_URL });
  const json = JSON.stringify(collection, null, 2);
  JSON.parse(json); // 確認輸出為有效 JSON

  fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
  fs.writeFileSync(OUTPUT_PATH, json + '\n');

  const requestCount = collection.item.reduce((n, folder) => n + folder.item.length, 0);
  console.log(
    `Postman collection generated: ${path.relative(ROOT, OUTPUT_PATH)} ` +
    `(${collection.item.length} folders, ${requestCount} requests)`
  );
}

if (require.main === module) main();

module.exports = { buildCollection, exampleFromSchema };
