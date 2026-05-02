export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    function getContentType(path) {
      if (path.endsWith('.png')) return 'image/png';
      if (path.endsWith('.ico')) return 'image/x-icon';
      if (path.endsWith('.jpg') || path.endsWith('.jpeg')) return 'image/jpeg';
      if (path.endsWith('.svg')) return 'image/svg+xml';
      if (path.endsWith('.webmanifest')) return 'application/manifest+json';
      if (path.endsWith('.js')) return 'application/javascript';
      if (path.endsWith('.css')) return 'text/css';
      if (path.endsWith('.html')) return 'text/html';
      return 'application/octet-stream';
    }

    // 1. Tentar buscar o arquivo real primeiro
    // No Cloudflare Pages, usamos env.ASSETS.fetch(request)
    let response = await env.ASSETS.fetch(request);

    if (response.status < 400) {
      // Retornar o arquivo com o tipo correto para binários e manifestos
      const newResponse = new Response(response.body, response);
      
      const customContentType = getContentType(path);
      if (customContentType !== 'application/octet-stream') {
        newResponse.headers.set('Content-Type', customContentType);
      }
      
      return newResponse;
    }

    // 2. Só retornar index.html se for uma navegação de página 
    // ou seja, se for uma requisição pedindo HTML
    const acceptHeader = request.headers.get('Accept') || '';
    if (request.mode === 'navigate' || acceptHeader.includes('text/html')) {
        const indexUrl = new URL('/', request.url);
        const indexResponse = await env.ASSETS.fetch(new Request(indexUrl, request));
        if (indexResponse.status < 400) {
            const finalIndex = new Response(indexResponse.body, indexResponse);
            finalIndex.headers.set('Content-Type', 'text/html');
            return finalIndex;
        }
    }

    // 3. Se não for nada disso, retornar 404 real, não o index.html
    return new Response('Not Found', { status: 404 });
  }
};
