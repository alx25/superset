import { readIsAdminHint } from '../adapters/exploreAdapter';

function docWithBootstrap(bootstrap: unknown): Document {
  document.body.innerHTML = '<div id="app"></div>';
  const app = document.getElementById('app') as HTMLElement;
  if (bootstrap !== undefined) app.setAttribute('data-bootstrap', JSON.stringify(bootstrap));
  return document;
}

describe('readIsAdminHint — pista de rol Admin, nunca autoritativa', () => {
  test('true cuando bootstrap.user.roles tiene la clave "Admin"', () => {
    const doc = docWithBootstrap({ user: { roles: { Admin: [['can_write', 'Chart']] } } });
    expect(readIsAdminHint(doc)).toBe(true);
  });

  test('false cuando el usuario tiene otro rol pero no Admin', () => {
    const doc = docWithBootstrap({ user: { roles: { Gamma: [['can_read', 'Chart']] } } });
    expect(readIsAdminHint(doc)).toBe(false);
  });

  test('false cuando no hay data-bootstrap en #app', () => {
    const doc = docWithBootstrap(undefined);
    expect(readIsAdminHint(doc)).toBe(false);
  });

  test('false cuando #app no existe', () => {
    document.body.innerHTML = '';
    expect(readIsAdminHint(document)).toBe(false);
  });

  test('false (no revienta) cuando data-bootstrap no es JSON válido', () => {
    document.body.innerHTML = '<div id="app" data-bootstrap="{not valid json"></div>';
    expect(readIsAdminHint(document)).toBe(false);
  });

  test('false cuando user.roles no viene (bootstrap sin include_perms)', () => {
    const doc = docWithBootstrap({ user: { username: 'ana' } });
    expect(readIsAdminHint(doc)).toBe(false);
  });
});
