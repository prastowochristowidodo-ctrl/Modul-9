const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../src/app');

let server;
let base;

before(async () => {
  server = createApp().listen(0);

  await new Promise(resolve => server.once('listening', resolve));

  const port = server.address().port;
  base = `http://127.0.0.1:${port}`;
});

after(async () => {
  await new Promise((resolve, reject) => {
    server.close(err => err ? reject(err) : resolve());
  });
});

async function request(method, path = '', body) {
  return fetch(base + '/api/products' + path, {
    method,
    headers: body !== undefined
      ? { 'Content-Type': 'application/json' }
      : {},
    body: body !== undefined ? JSON.stringify(body) : undefined
  });
}

async function expectError(response, status, code) {
  assert.equal(response.status, status);

  const result = await response.json();

  assert.equal(result.error.code, code);

  return result.error;
}

const product = {
  name: 'Mouse',
  price: 75000,
  stock: 10
};

test('Input tidak valid, termasuk field tambahan, ditolak', async () => {
  const response = await request('POST', '', {
    id: 99,
    name: '   ',
    price: '75000'
  });

  const error = await expectError(response, 400, 'INVALID_INPUT');

  assert.equal(error.details.length, 4);

  await expectError(
    await request('GET', '/1.5'),
    400,
    'INVALID_ID'
  );
});

test('JSON rusak, tipe body, dan batas ukuran ditangani', async () => {
  const url = base + '/api/products';

  const send = (type, body) => fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': type },
    body
  });

  await expectError(
    await send('application/json', '{"name":'),
    400,
    'INVALID_JSON'
  );

  await expectError(
    await send('text/plain', 'Mouse'),
    415,
    'UNSUPPORTED_MEDIA_TYPE'
  );

  const large = JSON.stringify({
    name: 'x'.repeat(17000),
    price: 1,
    stock: 1
  });

  await expectError(
    await send('application/json', large),
    413,
    'BODY_TOO_LARGE'
  );
});

test('Produk dan rute yang tidak ditemukan memiliki kode berbeda', async () => {
  await expectError(
    await request('GET', '/999'),
    404,
    'PRODUCT_NOT_FOUND'
  );

  await expectError(
    await request('PUT', '/999', product),
    404,
    'PRODUCT_NOT_FOUND'
  );

  await expectError(
    await request('PATCH', '/999', { price: 1 }),
    404,
    'PRODUCT_NOT_FOUND'
  );

  await expectError(
    await request('DELETE', '/999'),
    404,
    'PRODUCT_NOT_FOUND'
  );

  await expectError(
    await fetch(base + '/api/unknown'),
    404,
    'ROUTE_NOT_FOUND'
  );
});

test('Stock dapat bernilai 0 dan nilai negatif ditolak', async () => {
  const response = await request('POST', '', {
    name: 'Keyboard',
    price: 150000,
    stock: 0
  });

  assert.equal(response.status, 201);

  const result = await response.json();

  assert.equal(result.data.stock, 0);

  await expectError(
    await request('POST', '', {
      name: 'Mouse',
      price: 75000,
      stock: -5
    }),
    400,
    'INVALID_INPUT'
  );
});

test('PUT mengganti data produk dan stock', async () => {
  const created = await request('POST', '', product);
  const result = await created.json();
  const id = result.data.id;

  const invalid = await request('PUT', '/' + id, {
    name: 'Keyboard',
    price: 150000
  });

  await expectError(invalid, 400, 'INVALID_INPUT');

  const response = await request('PUT', '/' + id, {
    name: 'Keyboard',
    price: 150000,
    stock: 20
  });

  assert.equal(response.status, 200);

  const updated = await response.json();

  assert.equal(updated.data.name, 'Keyboard');
  assert.equal(updated.data.price, 150000);
  assert.equal(updated.data.stock, 20);
});

test('PATCH harga mempertahankan stock', async () => {
  const response = await request('POST', '', {
    name: 'Mouse',
    price: 75000,
    stock: 10
  });

  const result = await response.json();
  const id = result.data.id;

  const update = await request('PATCH', '/' + id, {
    price: 85000
  });

  assert.equal(update.status, 200);

  const updated = await update.json();

  assert.equal(updated.data.price, 85000);
  assert.equal(updated.data.stock, 10);
});

test('PATCH dapat mengubah stock', async () => {
  const response = await request('POST', '', {
    name: 'Mouse',
    price: 75000,
    stock: 10
  });

  const result = await response.json();
  const id = result.data.id;

  const update = await request('PATCH', '/' + id, {
    stock: 5
  });

  assert.equal(update.status, 200);

  const updated = await update.json();

  assert.equal(updated.data.stock, 5);
});

test('DELETE mengembalikan 204 dan produk tidak bisa dibaca lagi', async () => {
  const created = await request('POST', '', product);
  const result = await created.json();
  const id = result.data.id;

  const response = await request('DELETE', '/' + id);

  assert.equal(response.status, 204);
  assert.equal(await response.text(), '');

  await expectError(
    await request('GET', '/' + id),
    404,
    'PRODUCT_NOT_FOUND'
  );
});