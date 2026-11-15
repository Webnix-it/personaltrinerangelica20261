/* ============================================================
   DASHBOARD ADMIN — accesso Google e gestione recensioni
   ============================================================ */
(function () {
  'use strict';

  var $ = function (selector, scope) {
    return (scope || document).querySelector(selector);
  };
  var $$ = function (selector, scope) {
    return Array.prototype.slice.call((scope || document).querySelectorAll(selector));
  };

  var gate = $('#adminGate');
  var app = $('#adminApp');
  var gateStatus = $('#gateStatus');
  var loginBtn = $('#googleLogin');
  var logoutBtn = $('#logoutBtn');

  var form = $('#reviewForm');
  var nameInput = $('#reviewName');
  var initialInput = $('#reviewInitial');
  var textInput = $('#reviewText');
  var submitLabel = $('#reviewSubmitLabel');
  var cancelBtn = $('#reviewCancel');
  var formStatus = $('#formStatus');

  var starsField = $('#starsField');
  var searchInput = $('#reviewSearch');
  var listEl = $('#reviewsList');
  var countEl = $('#reviewCount');
  var toastEl = $('#adminToast');

  var modal = $('#confirmModal');

  var reviews = [];
  var filterText = '';
  var editingId = null;
  var pendingDeleteId = null;
  var rating = 5;
  var unsubscribe = null;
  var toastTimer = null;

  /* ---------------- utilità ---------------- */

  function toast(message, type) {
    toastEl.textContent = message;
    toastEl.className = 'admin-toast is-visible' + (type ? ' is-' + type : '');
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(function () {
      toastEl.className = 'admin-toast';
    }, 4200);
  }

  function setFormStatus(message, type) {
    formStatus.textContent = message || '';
    formStatus.className = 'admin-form-status' + (type ? ' is-' + type : '');
  }

  function formatError(error) {
    var code = error && error.code ? String(error.code) : '';

    /* Errori di accesso: spiegano cosa sistemare nella Console Firebase. */
    if (code.indexOf('unauthorized-domain') !== -1) {
      return (
        'Dominio non autorizzato. In Firebase → Authentication → Settings → Authorized domains aggiungi ' +
        window.location.origin +
        ' (per i test in locale aggiungi anche localhost).'
      );
    }
    if (code.indexOf('operation-not-allowed') !== -1) {
      return 'Il provider Google non è attivo: Firebase → Authentication → Sign-in method → Google → Attiva.';
    }
    if (code.indexOf('popup-blocked') !== -1) {
      return 'Il browser ha bloccato la finestra di accesso: consenti i popup per questo sito e riprova.';
    }
    if (code.indexOf('invalid-api-key') !== -1) {
      return 'La apiKey in firebase-config.js non è valida: ricontrolla la configurazione del progetto.';
    }
    if (code.indexOf('network-request-failed') !== -1) {
      return 'Connessione a Firebase non disponibile: controlla la rete e riprova.';
    }
    if (code.indexOf('account-exists-with-different-credential') !== -1) {
      return 'Questo indirizzo è già registrato con un altro metodo di accesso.';
    }

    if (code.indexOf('permission-denied') !== -1) {
      return 'Permessi insufficienti: controlla le regole Firestore e l’email admin.';
    }
    if (code.indexOf('unavailable') !== -1) {
      return 'Connessione a Firebase non disponibile. Riprova tra poco.';
    }
    if (code.indexOf('unauthenticated') !== -1) {
      return 'Sessione scaduta: accedi di nuovo.';
    }
    return (error && error.message) || 'Si è verificato un errore. Riprova.';
  }

  /* ---------------- stelle ---------------- */

  function paintStars(value) {
    rating = value;
    $$('.admin-star', starsField).forEach(function (star) {
      var active = Number(star.dataset.value) <= value;
      star.classList.toggle('is-on', active);
      star.setAttribute('aria-checked', String(Number(star.dataset.value) === value));
    });
  }

  starsField.addEventListener('click', function (event) {
    var star = event.target.closest('.admin-star');
    if (!star) return;
    paintStars(Number(star.dataset.value));
  });

  /* ---------------- accesso ---------------- */

  function showGate(message, isError) {
    gate.hidden = false;
    app.hidden = true;
    gateStatus.textContent = message || '';
    gateStatus.className = 'admin-gate-status' + (isError ? ' is-error' : '');
  }

  /* 127.0.0.1 non è tra i domini autorizzati del progetto Firebase:
     il popup di Google si apre ma non riesce a tornare indietro. */
  function localHostHint() {
    var host = window.location.hostname;
    if (host !== '127.0.0.1' && host !== '[::1]') return '';
    return (
      'Apri la dashboard da http://localhost:' + (window.location.port || '80') +
      '/admin.html: il dominio 127.0.0.1 non è autorizzato in Firebase, quindi l’accesso Google non si completa.'
    );
  }

  function showApp(user) {
    gate.hidden = true;
    app.hidden = false;

    var mail = user && user.email ? user.email : '—';
    $('#userEmail').textContent = mail;
    $('#userAvatar').textContent = (mail.charAt(0) || 'A').toUpperCase();
  }

  loginBtn.addEventListener('click', function () {
    if (!window.SiteFirebase.isConfigured()) return;

    loginBtn.disabled = true;
    gateStatus.textContent = 'Apertura della finestra di accesso Google…';
    gateStatus.className = 'admin-gate-status';

    window.SiteFirebase.signInWithGoogle()
      .catch(function (error) {
        if (localHostHint()) {
          gateStatus.textContent = localHostHint();
          gateStatus.className = 'admin-gate-status is-error';
          return;
        }
        if (error && error.code === 'auth/popup-closed-by-user') {
          gateStatus.textContent = 'Accesso annullato.';
        } else {
          gateStatus.textContent = formatError(error);
          gateStatus.className = 'admin-gate-status is-error';
        }
      })
      .then(function () { loginBtn.disabled = false; });
  });

  logoutBtn.addEventListener('click', function () {
    window.SiteFirebase.signOutUser();
  });

  /* ---------------- menu laterale ---------------- */

  $$('.admin-nav-item').forEach(function (button) {
    button.addEventListener('click', function () {
      /* Il pulsante Guida non è un pannello. */
      if (!button.dataset.panel) return;

      $$('.admin-nav-item').forEach(function (item) {
        var active = item === button;
        item.classList.toggle('is-active', active);
        item.setAttribute('aria-current', active ? 'true' : 'false');
      });

      $$('.admin-panel').forEach(function (panel) {
        panel.classList.toggle('is-active', panel.id === 'panel-' + button.dataset.panel);
      });
    });
  });

  /* ---------------- lista ---------------- */

  function matches(review) {
    if (!filterText) return true;
    var haystack = (review.name + ' ' + review.initial + ' ' + review.text).toLowerCase();
    return haystack.indexOf(filterText) !== -1;
  }

  function starRow(value) {
    var wrap = document.createElement('div');
    wrap.className = 'admin-item-stars';
    wrap.setAttribute('role', 'img');
    wrap.setAttribute('aria-label', value + ' stelle su 5');
    for (var i = 0; i < 5; i++) {
      var icon = document.createElement('i');
      icon.className = 'bx ' + (i < value ? 'bxs-star' : 'bx-star');
      icon.setAttribute('aria-hidden', 'true');
      wrap.appendChild(icon);
    }
    return wrap;
  }

  function deleteButton() {
    var button = document.createElement('button');
    button.type = 'button';
    button.className = 'admin-delete';
    button.setAttribute('aria-label', 'Elimina recensione');
    button.innerHTML = '<svg viewBox="0 0 448 512" class="svgIcon" aria-hidden="true">'
      + '<path d="M135.2 17.7L128 32H32C14.3 32 0 46.3 0 64S14.3 96 32 96H416c17.7 0 32-14.3 32-32S433.7 32 416 32H320l-7.2-14.3C307.4 6.8 296.3 0 284.2 0H163.8c-12.1 0-23.2 6.8-28.6 17.7zM416 128H32L53.2 467c1.6 25.3 22.6 45 47.9 45H346.9c25.3 0 46.3-19.7 47.9-45L416 128z"></path>'
      + '</svg>';
    return button;
  }

  function renderList() {
    listEl.innerHTML = '';

    var visible = reviews.filter(matches);
    countEl.textContent = reviews.length
      ? visible.length + ' di ' + reviews.length
      : '';

    if (!visible.length) {
      var empty = document.createElement('p');
      empty.className = 'admin-empty';
      empty.textContent = reviews.length
        ? 'Nessuna recensione corrisponde alla ricerca.'
        : 'Nessuna recensione presente: usane una con il formulario qui sopra.';
      listEl.appendChild(empty);
      return;
    }

    visible.forEach(function (review) {
      var item = document.createElement('article');
      item.className = 'admin-item';

      var avatar = document.createElement('span');
      avatar.className = 'admin-item-avatar';
      avatar.setAttribute('aria-hidden', 'true');
      avatar.textContent = (review.name.charAt(0) || '?').toUpperCase();

      var body = document.createElement('div');
      body.className = 'admin-item-body';

      var head = document.createElement('div');
      head.className = 'admin-item-head';

      var name = document.createElement('strong');
      name.textContent = review.name + ' ' + review.initial + '.';

      head.appendChild(name);
      head.appendChild(starRow(review.stars));

      var text = document.createElement('p');
      text.className = 'admin-item-text';
      text.textContent = review.text;

      body.appendChild(head);
      body.appendChild(text);

      var actions = document.createElement('div');
      actions.className = 'admin-item-actions';

      var edit = document.createElement('button');
      edit.type = 'button';
      edit.className = 'admin-edit';
      edit.setAttribute('aria-label', 'Modifica recensione');
      edit.innerHTML = '<i class="bx bx-edit-alt" aria-hidden="true"></i><span>Modifica</span>';
      edit.addEventListener('click', function () { startEdit(review); });

      var remove = deleteButton();
      remove.addEventListener('click', function () { askDelete(review); });

      actions.appendChild(edit);
      actions.appendChild(remove);

      item.appendChild(avatar);
      item.appendChild(body);
      item.appendChild(actions);

      listEl.appendChild(item);
    });
  }

  /* ---------------- form ---------------- */

  function resetForm() {
    editingId = null;
    form.reset();
    paintStars(5);
    submitLabel.textContent = 'Salva recensione';
    cancelBtn.hidden = true;
    setFormStatus('');
  }

  function startEdit(review) {
    editingId = review.id;
    nameInput.value = review.name;
    initialInput.value = review.initial;
    textInput.value = review.text;
    paintStars(review.stars);
    submitLabel.textContent = 'Salva modifiche';
    cancelBtn.hidden = false;
    setFormStatus('Stai modificando la recensione di ' + review.name + '.', 'info');
    form.scrollIntoView({ behavior: 'smooth', block: 'center' });
    nameInput.focus();
  }

  cancelBtn.addEventListener('click', resetForm);

  initialInput.addEventListener('input', function () {
    var value = initialInput.value.replace(/[^a-zA-Z]/g, '').toUpperCase().slice(0, 1);
    initialInput.value = value;
  });

  function readForm() {
    var name = nameInput.value.trim();
    var initial = initialInput.value.trim().toUpperCase();
    var text = textInput.value.trim();

    if (name.length < 1) return { error: 'Inserisci il nome.' };
    if (!/^[A-Z]$/.test(initial)) return { error: 'Inserisci una sola lettera per il cognome.' };
    if (text.length < 5) return { error: 'La descrizione deve avere almeno 5 caratteri.' };

    return { data: { name: name, initial: initial, stars: rating, text: text } };
  }

  form.addEventListener('submit', function (event) {
    event.preventDefault();

    if (!window.SiteFirebase.isConfigured()) {
      setFormStatus('Firebase non è configurato: compila firebase-config.js per salvare.', 'error');
      return;
    }

    var result = readForm();
    if (result.error) {
      setFormStatus(result.error, 'error');
      return;
    }

    var submit = $('#reviewSubmit');
    submit.disabled = true;
    setFormStatus('Salvataggio in corso…', 'info');

    var wasEditing = Boolean(editingId);
    var action = wasEditing
      ? window.SiteFirebase.updateReview(editingId, result.data)
      : window.SiteFirebase.addReview(result.data);

    action
      .then(function () {
        resetForm();
        toast(wasEditing ? 'Recensione aggiornata.' : 'Recensione pubblicata.', 'ok');
      })
      .catch(function (error) {
        setFormStatus(formatError(error), 'error');
      })
      .then(function () { submit.disabled = false; });
  });

  /* ---------------- eliminazione ---------------- */

  function askDelete(review) {
    pendingDeleteId = review.id;
    modal.hidden = false;
    var confirmBtn = $('[data-modal="confirm"]', modal);
    if (confirmBtn) confirmBtn.focus();
  }

  function closeModal() {
    pendingDeleteId = null;
    modal.hidden = true;
  }

  modal.addEventListener('click', function (event) {
    var action = event.target.closest('[data-modal]');
    if (event.target === modal) { closeModal(); return; }
    if (!action) return;

    if (action.dataset.modal === 'cancel') { closeModal(); return; }

    if (action.dataset.modal === 'confirm' && pendingDeleteId) {
      var id = pendingDeleteId;
      closeModal();

      window.SiteFirebase.deleteReview(id)
        .then(function () { toast('Recensione eliminata.', 'ok'); })
        .catch(function (error) { toast(formatError(error), 'error'); });
    }
  });

  document.addEventListener('keydown', function (event) {
    if (event.key === 'Escape' && !modal.hidden) closeModal();
  });

  /* ---------------- ricerca ---------------- */

  searchInput.addEventListener('input', function () {
    filterText = searchInput.value.trim().toLowerCase();
    renderList();
  });

  $('#searchBtn').addEventListener('click', function () {
    searchInput.focus();
  });

  /* ---------------- dati ---------------- */

  function updateStats(source) {
    $('#statTotal').textContent = String(reviews.length);

    if (reviews.length) {
      var sum = reviews.reduce(function (total, review) { return total + review.stars; }, 0);
      $('#statAverage').textContent = (sum / reviews.length).toFixed(1).replace('.', ',');
    } else {
      $('#statAverage').textContent = '—';
    }

    $('#statSource').textContent = source;
  }

  function onReviews(list, source) {
    reviews = list;
    renderList();
    updateStats(source);
  }

  function startReviews() {
    if (unsubscribe) return;

    updateStats('Firebase');

    unsubscribe = window.SiteFirebase.subscribeReviews(
      function (list) { onReviews(list, 'Firebase'); },
      function (error) {
        $('#overviewNote').textContent = formatError(error);
        updateStats('Locale');
      }
    );
  }

  /* ---------------- guida interattiva ---------------- */

  var TOUR_STEPS = [
    {
      target: '.admin-topbar-logo',
      title: 'Logo',
      text: 'Il logo in alto a sinistra riporta alla Home del sito.',
    },
    {
      target: '#userEmail',
      title: 'Il tuo account',
      text: 'Mostra l’email con cui hai fatto l’accesso: è quella che Firebase usa per autorizzare le modifiche.',
    },
    {
      target: '.admin-home-btn',
      title: 'Pulsante Home',
      text: 'Apre la pagina pubblica del sito, così controlli subito il risultato di quello che hai salvato.',
    },
    {
      target: '#logoutBtn',
      title: 'Esci',
      text: 'Chiude la sessione e torna alla schermata di accesso con Google.',
    },
    {
      target: '.admin-sidebar',
      title: 'Menu laterale',
      text: 'Le sezioni della dashboard: Panoramica, Recensioni, Social & Link, Foto e Pulsanti. In fondo ci sono Tutorial e Istruzioni.',
    },
    {
      panel: 'overview',
      target: '#statTotal',
      title: 'Recensioni pubblicate',
      text: 'Quante recensioni ci sono adesso su Firebase: il numero si aggiorna da solo a ogni modifica.',
    },
    {
      panel: 'overview',
      target: '#statAverage',
      title: 'Valutazione media',
      text: 'La media delle stelle di tutte le recensioni. Se non ce ne sono ancora, resta un trattino.',
    },
    {
      panel: 'overview',
      target: '#statSource',
      title: 'Origine dati',
      text: 'Indica se i dati arrivano da Firebase o sono locali: se leggi Locale, Firebase non è raggiungibile.',
    },
    {
      panel: 'overview',
      target: '#maintenanceToggle',
      title: 'Banner di manutenzione',
      text: 'Il toggle mostra o nasconde il banner lime sotto la navbar del sito. Salva da solo, senza altri passaggi.',
    },
    {
      panel: 'recensioni',
      target: '#reviewName',
      title: 'Nome',
      text: 'Il nome del cliente che ha lasciato la recensione, da 1 a 40 caratteri.',
    },
    {
      panel: 'recensioni',
      target: '#reviewInitial',
      title: 'Iniziale del cognome',
      text: 'Una sola lettera maiuscola, per tutelare la privacy: il campo accetta solo un carattere da A a Z.',
    },
    {
      panel: 'recensioni',
      target: '#starsField',
      title: 'Stelle',
      text: 'Clicca la stella corrispondente, da 1 a 5: è la valutazione che verrà pubblicata.',
    },
    {
      panel: 'recensioni',
      target: '#reviewText',
      title: 'Descrizione',
      text: 'Il testo della recensione, da 5 a 1200 caratteri: compare nella Home sotto il nome.',
    },
    {
      panel: 'recensioni',
      target: '#reviewSubmit',
      title: 'Salva recensione',
      text: 'Pubblica la recensione nella Home. Se stai modificando una recensione esistente salva le correzioni e compare Annulla modifica.',
    },
    {
      panel: 'recensioni',
      target: '.admin-search-row',
      title: 'Ricerca',
      text: 'La lente espande il campo di ricerca: filtra la lista per nome, iniziale o testo mentre digiti.',
    },
    {
      panel: 'recensioni',
      target: '#reviewsList',
      title: 'Lista recensioni',
      text: 'Ogni scheda mostra autore, stelle e testo, con Modifica (ripopola il form) ed Elimina (chiede conferma prima di cancellare).',
    },
    {
      panel: 'social',
      target: '.admin-social-row:has([data-setting="social.instagram.url"])',
      title: 'Instagram',
      text: 'Inserisci l’indirizzo del profilo. Il toggle a destra decide se l’icona appare nel footer: spento, sparisce del tutto.',
    },
    {
      panel: 'social',
      target: '.admin-social-row:has([data-setting="social.tiktok.url"])',
      title: 'TikTok',
      text: 'Come Instagram: indirizzo del profilo e toggle per mostrarlo o nasconderlo nel footer.',
    },
    {
      panel: 'social',
      target: '.admin-social-row:has([data-setting="social.facebook.url"])',
      title: 'Facebook',
      text: 'Pagina Facebook collegata al pulsante del footer, con il suo interruttore di visibilità.',
    },
    {
      panel: 'social',
      target: '.admin-social-row:has([data-setting="social.youtube.url"])',
      title: 'YouTube',
      text: 'Canale YouTube mostrato nel footer, con il suo interruttore di visibilità.',
    },
    {
      panel: 'social',
      target: '.admin-social-row:has([data-setting="social.whatsapp.url"])',
      title: 'WhatsApp',
      text: 'Il link WhatsApp del sito: viene usato anche dal banner di manutenzione. Puoi inserire l’indirizzo completo wa.me o solo il numero.',
    },
    {
      panel: 'social',
      target: '.admin-social-row:has([data-setting="social.email.url"])',
      title: 'Email',
      text: 'L’indirizzo email del pulsante nel footer: basta scriverlo senza mailto:, ci pensa la Home ad aggiungerlo.',
    },
    {
      panel: 'social',
      target: '.admin-social-row:has([data-setting="social.google.url"])',
      title: 'Recensioni Google',
      text: 'Il collegamento alla scheda delle recensioni su Google, con il suo interruttore.',
    },
    {
      panel: 'social',
      target: '.admin-social-row:has([data-setting="pixel.id"])',
      title: 'Facebook Pixel',
      text: 'Inserisci l’ID Pixel e attiva il toggle: il tracciamento viene caricato sul sito pubblico, non qui in dashboard.',
    },
    {
      panel: 'social',
      target: '[data-save-settings="social"]',
      title: 'Salva Social & Link',
      text: 'Scrive profili e Pixel su Firebase: la Home applica le modifiche da sola, senza toccare il codice.',
    },
    {
      panel: 'foto',
      target: '.admin-image-row:has([data-setting="images.chiSono"])',
      title: 'Chi sono — prima foto',
      text: 'L’indirizzo della foto principale della sezione Chi sono: percorso locale o indirizzo completo.',
    },
    {
      panel: 'foto',
      target: '.admin-image-row:has([data-setting="images.chiSono2"])',
      title: 'Chi sono — seconda foto',
      text: 'La seconda immagine dello slideshow: le due foto si alternano ogni 3 secondi.',
    },
    {
      panel: 'foto',
      target: '.admin-image-row:has([data-setting="images.metodo"])',
      title: 'Metodo — atleta',
      text: 'La foto della sezione Metodo.',
    },
    {
      panel: 'foto',
      target: '#panel-foto .admin-image-previews',
      title: 'Anteprime',
      text: 'A sinistra vedi la foto attuale, a destra quella nuova: così controlli prima di salvare.',
    },
    {
      panel: 'foto',
      target: '[data-save-settings="foto"]',
      title: 'Salva Foto',
      text: 'Aggiorna gli indirizzi su Firebase: la Home usa subito le nuove immagini.',
    },
    {
      panel: 'pulsanti',
      target: '.admin-button-row:has([data-setting="buttons.prenota"])',
      title: 'Prenota la tua prima sessione gratuita',
      text: 'Inserisci un’email o un numero WhatsApp: i pulsanti con questo testo useranno quel collegamento.',
    },
    {
      panel: 'pulsanti',
      target: '.admin-button-row:has([data-setting="buttons.domanda"])',
      title: 'Hai una domanda? Contattami',
      text: 'Il collegamento del pulsante vicino alle FAQ, indipendente dagli altri.',
    },
    {
      panel: 'pulsanti',
      target: '.admin-button-row:has([data-setting="buttons.prenotaOra"])',
      title: 'Prenota ora',
      text: 'Il pulsante della sezione percorsi: puoi puntarlo a un’altra email o a un altro numero WhatsApp.',
    },
    {
      panel: 'pulsanti',
      target: '.admin-button-row:has([data-setting="buttons.percorso"])',
      title: 'Richiedi il percorso',
      text: 'I tre pulsanti delle card dei percorsi condividono questo collegamento.',
    },
    {
      panel: 'pulsanti',
      target: '.admin-button-row:has([data-setting="buttons.sessione"])',
      title: 'Sessione gratuita',
      text: 'Il pulsante in alto nella navbar del sito.',
    },
    {
      panel: 'pulsanti',
      target: '[data-save-settings="pulsanti"]',
      title: 'Salva Pulsanti',
      text: 'Salva tutti i collegamenti su Firebase: testo e stile dei pulsanti restano quelli del sito.',
    },
    {
      target: '#guideBtn',
      title: 'Tutorial',
      text: 'Riavvia questo tour guidato quando vuoi: ti accompagna elemento per elemento.',
    },
    {
      target: '#instructionsBtn',
      title: 'Istruzioni',
      text: 'Apre il manuale scritto con la spiegazione di ogni elemento, sezione per sezione.',
    },
  ];

  var tourIndex = 0;
  var tourActive = false;
  var tourCompleted = false;

  var tourSpot = $('#tourSpotlight');
  var tourTip = $('#tourTip');
  var tourProgress = $('#tourProgress');
  var tourTitle = $('#tourTitle');
  var tourText = $('#tourText');
  var tourPrev = $('#tourPrev');
  var tourNext = $('#tourNext');
  var tourEnd = $('#tourEnd');

  function placeTour() {
    var step = TOUR_STEPS[tourIndex];
    var target = step ? $(step.target) : null;
    if (!target) return;

    var rect = target.getBoundingClientRect();
    var pad = 8;

    tourSpot.style.top = Math.round(rect.top - pad) + 'px';
    tourSpot.style.left = Math.round(rect.left - pad) + 'px';
    tourSpot.style.width = Math.round(rect.width + pad * 2) + 'px';
    tourSpot.style.height = Math.round(rect.height + pad * 2) + 'px';

    var width = Math.min(340, window.innerWidth - 32);
    tourTip.style.width = width + 'px';

    var height = tourTip.offsetHeight;
    var left = Math.min(Math.max(16, rect.left), window.innerWidth - width - 16);
    var top = rect.bottom + 14;

    if (top + height > window.innerHeight - 16) {
      top = Math.max(16, rect.top - height - 14);
    }

    tourTip.style.left = Math.round(left) + 'px';
    tourTip.style.top = Math.round(top) + 'px';
  }

  function showTourStep(index) {
    tourIndex = index;
    tourCompleted = false;

    var step = TOUR_STEPS[index];
    var target = $(step.target);

    if (step.panel) {
      var navButton = $('.admin-nav-item[data-panel="' + step.panel + '"]');
      if (navButton) navButton.click();
      target = $(step.target);
    }

    tourPrev.hidden = false;
    tourNext.hidden = false;
    tourEnd.textContent = 'Termina guida';
    tourPrev.disabled = index === 0;
    tourNext.textContent = index === TOUR_STEPS.length - 1 ? 'Fine' : 'Avanti';
    tourProgress.textContent = 'Passaggio ' + (index + 1) + ' di ' + TOUR_STEPS.length;
    tourTitle.textContent = step.title;
    tourText.textContent = step.text;

    tourSpot.hidden = false;
    tourTip.hidden = false;

    if (target && target.scrollIntoView) {
      target.scrollIntoView({ block: 'center', inline: 'nearest' });
    }

    /* Aspetta che il pannello sia visibile prima di misurare. */
    window.setTimeout(placeTour, 80);
  }

  function startTour() {
    tourActive = true;
    tourCompleted = false;
    tourTip.style.transform = '';
    showTourStep(0);
  }

  function closeTour() {
    tourActive = false;
    tourCompleted = false;
    tourSpot.hidden = true;
    tourTip.hidden = true;
    tourEnd.textContent = 'Termina guida';
    tourPrev.hidden = false;
    tourNext.hidden = false;
  }

  function completeTour() {
    tourCompleted = true;
    tourSpot.hidden = true;
    tourProgress.textContent = '';
    tourTitle.textContent = 'Tutorial completato';
    tourText.textContent = 'Hai completato il tutorial della dashboard!';
    tourPrev.hidden = true;
    tourNext.hidden = true;
    tourEnd.textContent = 'Chiudi';

    var width = Math.min(320, window.innerWidth - 32);
    tourTip.style.width = width + 'px';
    tourTip.style.left = Math.round((window.innerWidth - width) / 2) + 'px';
    tourTip.style.top = Math.round(Math.max(16, window.innerHeight / 2 - 110)) + 'px';
    tourTip.hidden = false;

    toast('Hai completato il tutorial della dashboard!');
  }

  if (tourNext) {
    tourNext.addEventListener('click', function () {
      if (tourCompleted) { closeTour(); return; }
      if (tourIndex >= TOUR_STEPS.length - 1) { completeTour(); return; }
      showTourStep(tourIndex + 1);
    });

    tourPrev.addEventListener('click', function () {
      if (tourIndex > 0) showTourStep(tourIndex - 1);
    });

    tourEnd.addEventListener('click', function () { closeTour(); });

    document.addEventListener('keydown', function (event) {
      if (!tourActive || tourTip.hidden) return;
      if (event.key === 'Escape') closeTour();
      if (event.key === 'ArrowRight' && !tourCompleted) tourNext.click();
      if (event.key === 'ArrowLeft' && !tourCompleted && tourIndex > 0) tourPrev.click();
    });

    window.addEventListener('resize', function () {
      if (tourActive && !tourCompleted) placeTour();
    });

    window.addEventListener('scroll', function () {
      if (tourActive && !tourCompleted) placeTour();
    }, { passive: true });
  }

  var guideBtn = $('#guideBtn');
  if (guideBtn) guideBtn.addEventListener('click', startTour);

  /* ---------------- istruzioni (manuale scritto) ---------------- */

  var instructionsModal = $('#instructionsModal');
  var instructionsBtn = $('#instructionsBtn');

  function openInstructions() {
    if (!instructionsModal) return;
    instructionsModal.hidden = false;
    var closeBtn = $('[data-instructions-close]', instructionsModal);
    if (closeBtn) closeBtn.focus();
  }

  function closeInstructions() {
    if (!instructionsModal) return;
    instructionsModal.hidden = true;
  }

  if (instructionsBtn) instructionsBtn.addEventListener('click', openInstructions);

  if (instructionsModal) {
    instructionsModal.addEventListener('click', function (event) {
      var target = event.target;
      if (target === instructionsModal || (target.closest && target.closest('[data-instructions-close]'))) {
        closeInstructions();
      }
    });

    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape' && !instructionsModal.hidden) closeInstructions();
    });
  }

  /* ---------------- impostazioni del sito ---------------- */

  var settingsData = {};
  var settingsStarted = false;

  /* Valori usati finché la sezione non è mai stata salvata. */
  var SETTING_DEFAULTS = {
    'images.chiSono': 'https://ricomincia-angelica.higgsfield.app/ricomincia/assets/angelica-professionale.webp',
    'images.chiSono2': 'foto1.png',
    'images.metodo': 'foto1.png',
  };

  /* Trasforma quello che scrive l'utente in un collegamento vero:
     email → mailto:, numero → wa.me, URL → così com'è. */
  function normalizeLink(value) {
    var raw = String(value || '').trim();
    if (!raw) return '';
    if (/^(https?:|mailto:|tel:)/i.test(raw)) return raw;
    if (raw.indexOf('@') !== -1) return 'mailto:' + raw;
    if (/^[\d\s()+.-]+$/.test(raw)) return 'https://wa.me/' + raw.replace(/\D/g, '');
    return raw;
  }

  /* Anteprima dei pulsanti: usa il valore digitato nel campo. */
  function updateButtonPreviews() {
    $$('[data-button-preview]').forEach(function (link) {
      var path = link.getAttribute('data-button-preview');
      var input = $('[data-setting="' + path + '"]');
      var value = input ? input.value.trim() : '';
      var href = normalizeLink(value);

      link.setAttribute('href', href || '#');
      link.title = value ? href : 'Nessun collegamento impostato: resta quello predefinito del sito.';
    });
  }

  function getPath(object, path) {
    return path.split('.').reduce(function (value, key) {
      return value && typeof value === 'object' ? value[key] : undefined;
    }, object);
  }

  function setPath(object, path, value) {
    var keys = path.split('.');
    var current = object;

    keys.forEach(function (key, index) {
      if (index === keys.length - 1) {
        current[key] = value;
        return;
      }
      if (!current[key] || typeof current[key] !== 'object') current[key] = {};
      current = current[key];
    });
  }

  function updatePreviews() {
    $$('[data-preview]').forEach(function (img) {
      var path = img.getAttribute('data-preview');
      var value = getPath(settingsData, path) || SETTING_DEFAULTS[path] || '';
      if (value) img.src = value;
    });
  }

  function updateCurrentLinks() {
    $$('[data-current]').forEach(function (element) {
      var value = getPath(settingsData, element.getAttribute('data-current'));
      element.textContent = 'Collegamento attuale: ' + (value || 'predefinito del sito');
    });
  }

  function fillSettings(settings) {
    settingsData = settings || {};

    $$('[data-setting]').forEach(function (input) {
      if (document.activeElement === input) return;

      var path = input.getAttribute('data-setting');
      var value = getPath(settingsData, path);

      if (input.type === 'checkbox') {
        var fallback = path.indexOf('social.') === 0;
        input.checked = value === undefined ? fallback : Boolean(value);
        return;
      }

      if (value === undefined) value = SETTING_DEFAULTS[path];
      input.value = value === undefined || value === null ? '' : String(value);
    });

    updatePreviews();
    updateCurrentLinks();
    updateButtonPreviews();
  }

  function startSettings() {
    if (settingsStarted) return;
    settingsStarted = true;

    window.SiteFirebase.subscribeSettings(
      function (settings) { fillSettings(settings); },
      function (error) {
        var status = $('#maintenanceStatus');
        if (status) {
          status.textContent = formatError(error);
          status.className = 'admin-form-status is-error';
        }
      }
    );
  }

  /* Anteprima live dell'immagine digitata. */
  $$('[data-setting]').forEach(function (input) {
    input.addEventListener('input', function () {
      var path = input.getAttribute('data-setting');
      $$('[data-preview-typed="' + path + '"]').forEach(function (img) {
        var value = input.value.trim();
        if (value) img.src = value;
      });

      updateButtonPreviews();
    });
  });

  /* Salvataggio per singolo pannello. */
  $$('[data-save-settings]').forEach(function (button) {
    button.addEventListener('click', function () {
      var group = button.getAttribute('data-save-settings');
      var form = $('[data-settings-form="' + group + '"]');
      var status = $('[data-settings-status="' + group + '"]');
      if (!form) return;

      var payload = {};

      $$('[data-setting]', form).forEach(function (input) {
        var path = input.getAttribute('data-setting');
        var value = input.type === 'checkbox' ? input.checked : input.value.trim();
        setPath(payload, path, value);
      });

      button.disabled = true;
      if (status) {
        status.textContent = 'Salvataggio…';
        status.className = 'admin-form-status';
      }

      window.SiteFirebase.saveSettings(payload)
        .then(function () {
          if (status) {
            status.textContent = 'Salvato. Le modifiche sono già online.';
            status.className = 'admin-form-status is-info';
          }

          /* Aggiorna i riferimenti locali senza aspettare un nuovo snapshot. */
          $$('[data-setting]', form).forEach(function (input) {
            var path = input.getAttribute('data-setting');
            setPath(settingsData, path, input.type === 'checkbox' ? input.checked : input.value.trim());
          });

          updatePreviews();
          updateCurrentLinks();
          updateButtonPreviews();
          toast('Impostazioni salvate.');
        })
        .catch(function (error) {
          if (status) {
            status.textContent = formatError(error);
            status.className = 'admin-form-status is-error';
          }
        })
        .then(function () { button.disabled = false; });
    });
  });

  /* Mostra subito le anteprime predefinite, prima del login. */
  updatePreviews();
  updateCurrentLinks();
  updateButtonPreviews();

  /* Banner di manutenzione: il toggle salva subito. */
  var maintenanceToggle = $('#maintenanceToggle');
  var maintenanceStatus = $('#maintenanceStatus');

  if (maintenanceToggle) {
    maintenanceToggle.addEventListener('change', function () {
      var on = maintenanceToggle.checked;
      maintenanceToggle.disabled = true;

      if (maintenanceStatus) {
        maintenanceStatus.textContent = on ? 'Attivazione del banner…' : 'Disattivazione del banner…';
        maintenanceStatus.className = 'admin-form-status';
      }

      window.SiteFirebase.saveSettings({ maintenance: { on: on } })
        .then(function () {
          settingsData.maintenance = { on: on };
          if (maintenanceStatus) {
            maintenanceStatus.textContent = on
              ? 'Banner attivo sulla Home.'
              : 'Banner nascosto: non occupa spazio.';
            maintenanceStatus.className = 'admin-form-status is-info';
          }
          toast(on ? 'Banner di manutenzione attivato.' : 'Banner di manutenzione disattivato.');
        })
        .catch(function (error) {
          maintenanceToggle.checked = !on;
          if (maintenanceStatus) {
            maintenanceStatus.textContent = formatError(error);
            maintenanceStatus.className = 'admin-form-status is-error';
          }
        })
        .then(function () { maintenanceToggle.disabled = false; });
    });
  }

  /* ---------------- avvio ---------------- */

  function init() {
    if (!window.SiteFirebase) {
      showGate('Modulo Firebase non caricato.', true);
      return;
    }

    if (!window.SiteFirebase.isConfigured()) {
      loginBtn.disabled = true;
      showGate(
        'Firebase non è ancora configurato: incolla i dati del progetto in firebase-config.js e pubblica le regole di regolefirebase.txt.',
        true
      );
      return;
    }

    /* Se si arriva da un accesso via redirect, eventuali errori vanno mostrati. */
    if (typeof window.SiteFirebase.completeRedirect === 'function') {
      window.SiteFirebase.completeRedirect().then(function (result) {
        if (result && result.code) {
          showGate(formatError(result), true);
        }
      });
    }

    window.SiteFirebase.onAuthChange(function (user) {
      if (!user) {
        var hint = localHostHint();
        showGate(hint, Boolean(hint));
        return;
      }

      if (!window.SiteFirebase.isAdminEmail(user.email)) {
        var autorizzati = (window.ADMIN_EMAILS || []).join(', ');
        showGate(
          'Accesso negato: l’account ' + (user.email || 'sconosciuto') + ' non è abilitato.' +
            (autorizzati ? ' Account autorizzato: ' + autorizzati : ''),
          true
        );
        window.SiteFirebase.signOutUser();
        return;
      }

      showApp(user);
      startReviews();
      startSettings();
    });
  }

  init();
})();
