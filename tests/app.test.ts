import request from 'supertest';
import app from '../src/app';

describe('Health Check', () => {
  it('should return 200 OK on /health', async () => {
    const response = await request(app).get('/health');
    expect(response.status).toBe(200);
    expect(response.body).toHaveProperty('status', 'ok');
    expect(response.body).toHaveProperty('timestamp');
  });
});

describe('Not Found Handler', () => {
  it('should return 404 for unknown routes', async () => {
    const response = await request(app).get('/unknown-route');
    expect(response.status).toBe(404);
    expect(response.body).toHaveProperty('success', false);
    expect(response.body).toHaveProperty('error');
  });
});

describe('Auth Middleware', () => {
  it('should return 401 for protected routes without auth header', async () => {
    const response = await request(app).get('/api/ledgers');
    expect(response.status).toBe(401);
    expect(response.body).toHaveProperty('success', false);
  });

  it('should return 401 for invalid bearer token format', async () => {
    const response = await request(app)
      .get('/api/ledgers')
      .set('Authorization', 'InvalidFormat');
    expect(response.status).toBe(401);
    expect(response.body).toHaveProperty('success', false);
  });
});
