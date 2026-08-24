document.addEventListener('DOMContentLoaded', function() {
    console.log('DOM completamente cargado y procesado');

    const chatButton = document.getElementById('chatButton');
    const chatWindow = document.getElementById('chatWindow');
    const closeChat = document.getElementById('closeChat');

    if (!chatButton || !chatWindow || !closeChat) {
        return;
    }

    chatButton.addEventListener('click', function() {
        chatWindow.classList.add('show');
        console.log('Ventana de chat abierta');
    });

    closeChat.addEventListener('click', function() {
        chatWindow.classList.remove('show');
        console.log('Ventana de chat cerrada');
    });

    document.addEventListener('click', function(event) {
        if (!chatWindow.contains(event.target) && !chatButton.contains(event.target)) {
            chatWindow.classList.remove('show');
            console.log('Ventana de chat cerrada por clic fuera de la ventana');
        }
    });

    window.openTab = async function(evt, tabName) {
        console.log(`Pestaña seleccionada: ${tabName}`);

        const tabcontent = document.getElementsByClassName('tabcontent');
        const tablinks = document.getElementsByClassName('tablinks');

        for (let i = 0; i < tabcontent.length; i++) {
            tabcontent[i].style.display = 'none';
        }

        for (let i = 0; i < tablinks.length; i++) {
            tablinks[i].className = tablinks[i].className.replace(' active', '');
        }

        document.getElementById(tabName).style.display = 'block';
        evt.currentTarget.className += ' active';

        if (tabName === 'Marcadores' && typeof window.loadSavedStates === 'function') {
            window.loadSavedStates();
        }

        if (tabName === 'Estados' && typeof window.loadStates === 'function') {
            const userResponse = await fetch('/api/v1/me/');
            const userData = await userResponse.json();
            const userId = userData.result.id;
            await window.loadStates(userId);
        }

        if (tabName === 'Chatbot') {
            loadChat();
        }
    };

    function loadChat() {
        console.log('Ejecutando loadChat()');

        fetch('/api/v1/me/')
            .then(response => response.json())
            .then(data => {
                const chatIframe = document.getElementById('chatIframe');
                if (!chatIframe) {
                    return;
                }

                const encodedData = encodeURIComponent(JSON.stringify(data.result));
                const chatUrl = `https://webchat.botframework.com/embed/prueba_botv2?s=F2ZSmcab_SI.WmBRgWeDQB_UgEcQJ5JpTdLqTlxCOFo1o5iQkb-dvJE&username=${encodedData}`;
                console.log('URL generada para el chat:', chatUrl);
                chatIframe.src = chatUrl;
            })
            .catch(error => {
                console.error('Error al obtener el nombre de usuario:', error);
            });
    }

    const firstTab = document.querySelector('.tablinks');
    if (firstTab) {
        firstTab.click();
    }
});