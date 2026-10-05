/**
 * Licensed to the Apache Software Foundation (ASF) under one
 * or more contributor license agreements.  See the NOTICE file
 * distributed with this work for additional information
 * regarding copyright ownership.  The ASF licenses this file
 * to you under the Apache License, Version 2.0 (the
 * "License"); you may not use this file except in compliance
 * with the License.  You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing,
 * software distributed under the License is distributed on an
 * "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
 * KIND, either express or implied.  See the License for the
 * specific language governing permissions and limitations
 * under the License.
 */
import domToImage from 'dom-to-image-more';
import {
  captureChartScreenshot,
  convertImageToJpeg,
  uploadChartScreenshot,
  ChartScreenshotError,
} from '../adapters/chartScreenshotAdapter';

jest.mock('dom-to-image-more', () => ({
  __esModule: true,
  default: { toJpeg: jest.fn() },
}));

const toJpegMock = domToImage.toJpeg as jest.MockedFunction<typeof domToImage.toJpeg>;

// 1x1 JPEG real en base64 -- suficiente para que atob() decodifique bytes válidos.
const TINY_JPEG_DATA_URL =
  'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAMCAgICAgMCAgIDAwMDBAYEBAQEBAgGBgUGCQgKCgkICQkKDA8MCgsOCwkJDRENDg8QEBEQCgwSExIQEw8QEBD/2wBDAQMDAwQDBAgEBAgQCwkLEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBD/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAj/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCdABmX/9k=';

describe('captureChartScreenshot', () => {
  afterEach(() => {
    document.body.innerHTML = '';
    toJpegMock.mockReset();
  });

  test('sin .panel-body .chart-container en la página, rechaza con ChartScreenshotError', async () => {
    await expect(captureChartScreenshot()).rejects.toThrow(ChartScreenshotError);
    expect(toJpegMock).not.toHaveBeenCalled();
  });

  test('con el contenedor presente, llama a domToImage.toJpeg y devuelve un Blob JPEG', async () => {
    document.body.innerHTML = '<div class="panel-body"><div class="chart-container">x</div></div>';
    toJpegMock.mockResolvedValue(TINY_JPEG_DATA_URL);

    const blob = await captureChartScreenshot();

    expect(toJpegMock).toHaveBeenCalledTimes(1);
    const [node, options] = toJpegMock.mock.calls[0];
    expect((node as HTMLElement).className).toBe('chart-container');
    expect(options?.quality).toBe(0.85);
    expect(blob.type).toBe('image/jpeg');
    expect(blob.size).toBeGreaterThan(0);
  });

  test('con un spinner de carga adentro, espera a que desaparezca antes de capturar', async () => {
    jest.useFakeTimers();
    document.body.innerHTML =
      '<div class="panel-body"><div class="chart-container"><div data-test="loading-indicator"></div></div></div>';
    toJpegMock.mockResolvedValue(TINY_JPEG_DATA_URL);

    const promise = captureChartScreenshot();
    await Promise.resolve();
    expect(toJpegMock).not.toHaveBeenCalled(); // sigue esperando, no capturó el spinner

    // el spinner desaparece -- como pasaría cuando la consulta real termina
    document.querySelector('[data-test="loading-indicator"]')!.remove();
    await jest.advanceTimersByTimeAsync(300);

    const blob = await promise;
    expect(toJpegMock).toHaveBeenCalledTimes(1);
    expect(blob.type).toBe('image/jpeg');
    jest.useRealTimers();
  });

  test('si el spinner nunca desaparece, rechaza con un error claro tras el timeout -- nunca captura el spinner', async () => {
    jest.useFakeTimers();
    document.body.innerHTML =
      '<div class="panel-body"><div class="chart-container"><div data-test="loading-indicator"></div></div></div>';

    const promise = captureChartScreenshot();
    const assertion = expect(promise).rejects.toThrow('El gráfico todavía está cargando');
    await jest.advanceTimersByTimeAsync(30000);
    await assertion;

    expect(toJpegMock).not.toHaveBeenCalled();
    jest.useRealTimers();
  });
});

describe('convertImageToJpeg', () => {
  // jsdom no implementa `createImageBitmap` ni canvas 2D -- se mockean los
  // dos, igual que `toJpegMock` mockea `dom-to-image-more` arriba. No se
  // prueba el contenido real de los píxeles (eso es responsabilidad del
  // navegador), solo el contrato: tamaño resultante, fondo blanco para
  // transparencia, y los dos modos de fallo (archivo inválido, canvas sin
  // soporte de toBlob).
  let getContextSpy: jest.SpyInstance;
  let toBlobSpy: jest.SpyInstance;
  let fillRectMock: jest.Mock;
  let drawImageMock: jest.Mock;
  let lastToBlobResult: Blob | null;

  beforeEach(() => {
    lastToBlobResult = new Blob(['jpeg-bytes'], { type: 'image/jpeg' });
    fillRectMock = jest.fn();
    drawImageMock = jest.fn();
    getContextSpy = jest.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      fillStyle: '',
      fillRect: fillRectMock,
      drawImage: drawImageMock,
    } as unknown as CanvasRenderingContext2D);
    toBlobSpy = jest.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(function toBlob(
      this: HTMLCanvasElement,
      callback: BlobCallback,
    ) {
      callback(lastToBlobResult);
    });
    (globalThis as unknown as { createImageBitmap: jest.Mock }).createImageBitmap = jest.fn().mockResolvedValue({
      width: 800,
      height: 600,
      close: jest.fn(),
    });
  });

  afterEach(() => {
    getContextSpy.mockRestore();
    toBlobSpy.mockRestore();
    delete (globalThis as { createImageBitmap?: unknown }).createImageBitmap;
  });

  test('convierte una imagen chica (sin reescalar) a JPEG', async () => {
    const result = await convertImageToJpeg(new Blob(['png-bytes'], { type: 'image/png' }));

    expect(result.type).toBe('image/jpeg');
    expect(fillRectMock).toHaveBeenCalled(); // fondo blanco para transparencia
    expect(drawImageMock).toHaveBeenCalledWith(expect.anything(), 0, 0, 800, 600);
  });

  test('reescala cuando el ancho supera el máximo', async () => {
    (globalThis as unknown as { createImageBitmap: jest.Mock }).createImageBitmap = jest.fn().mockResolvedValue({
      width: 3200,
      height: 1600,
      close: jest.fn(),
    });

    await convertImageToJpeg(new Blob(['png-bytes'], { type: 'image/png' }), 1600);

    expect(drawImageMock).toHaveBeenCalledWith(expect.anything(), 0, 0, 1600, 800);
  });

  test('archivo que no es una imagen válida rechaza con ChartScreenshotError', async () => {
    (globalThis as unknown as { createImageBitmap: jest.Mock }).createImageBitmap = jest
      .fn()
      .mockRejectedValue(new Error('no es una imagen'));

    await expect(convertImageToJpeg(new Blob(['no-es-una-imagen']))).rejects.toThrow(ChartScreenshotError);
  });

  test('si el canvas no puede producir un Blob, rechaza con ChartScreenshotError', async () => {
    lastToBlobResult = null;

    await expect(convertImageToJpeg(new Blob(['png-bytes'], { type: 'image/png' }))).rejects.toThrow(
      ChartScreenshotError,
    );
  });
});

describe('uploadChartScreenshot', () => {
  let fetchMock: jest.Mock;

  function jsonResponse(status: number, body: unknown): Response {
    return { ok: status >= 200 && status < 300, status, json: () => Promise.resolve(body) } as unknown as Response;
  }

  beforeEach(() => {
    fetchMock = jest.fn();
    (globalThis as unknown as { fetch: typeof fetchMock }).fetch = fetchMock;
  });

  test('manda multipart con los campos correctos y el header CSRF, devuelve el capture_id', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { capture_id: 'cap-abc' }));
    const blob = new Blob(['x'], { type: 'image/jpeg' });

    const captureId = await uploadChartScreenshot(blob, {
      sliceId: 54,
      formDataKey: 'key-1',
      datasourceId: 5,
      detail: 'el color se ve mal',
    });

    expect(captureId).toBe('cap-abc');
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/extensions/irex/irex-mcp-tools/chart-screenshots/upload');
    expect(init.method).toBe('POST');
    expect(init.headers['X-CSRFToken']).toBe('csrf-de-prueba');
    const body = init.body as FormData;
    expect(body.get('dataset_id')).toBe('5');
    expect(body.get('form_data_key')).toBe('key-1');
    expect(body.get('slice_id')).toBe('54');
    expect(body.get('detail')).toBe('el color se ve mal');
    expect(body.get('image')).toBeInstanceOf(Blob);
  });

  test('sliceId null (gráfico sin guardar) no manda el campo slice_id', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { capture_id: 'cap-abc' }));
    await uploadChartScreenshot(new Blob(['x']), {
      sliceId: null,
      formDataKey: 'key-1',
      datasourceId: 5,
      detail: '',
    });
    const body = fetchMock.mock.calls[0][1].body as FormData;
    expect(body.get('slice_id')).toBeNull();
  });

  test('respuesta con error trae el mensaje del backend', async () => {
    fetchMock.mockResolvedValue(jsonResponse(413, { message: 'La captura supera el límite de 3 MB.' }));
    await expect(
      uploadChartScreenshot(new Blob(['x']), { sliceId: 1, formDataKey: 'k', datasourceId: 1, detail: '' }),
    ).rejects.toThrow('La captura supera el límite de 3 MB.');
  });

  test('respuesta con error sin cuerpo JSON usable cae a un mensaje genérico con el status', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 500, json: () => Promise.reject(new Error('no json')) } as unknown as Response);
    await expect(
      uploadChartScreenshot(new Blob(['x']), { sliceId: 1, formDataKey: 'k', datasourceId: 1, detail: '' }),
    ).rejects.toThrow('No se pudo subir la captura (HTTP 500).');
  });

  test('respuesta 200 sin capture_id válido se rechaza en vez de devolver algo inválido', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, {}));
    await expect(
      uploadChartScreenshot(new Blob(['x']), { sliceId: 1, formDataKey: 'k', datasourceId: 1, detail: '' }),
    ).rejects.toThrow(ChartScreenshotError);
  });
});
