import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import RecaptchaPlugin from 'puppeteer-extra-plugin-recaptcha';
import AdblockerPlugin from 'puppeteer-extra-plugin-adblocker';
import UserAgent from 'user-agents';
import crypto from 'crypto';
import cron from 'node-cron';
import { logger } from '../index.js';

// Configuration des plugins Puppeteer pour l'anti-détection
puppeteer.use(StealthPlugin());
puppeteer.use(AdblockerPlugin({ blockTrackers: true }));
puppeteer.use(RecaptchaPlugin({
  provider: { id: '2captcha', token: process.env.RECAPTCHA_TOKEN },
  visualFeedback: true
}));

export class VintedManager {
  constructor(proxyManager) {
    this.proxyManager = proxyManager;
    this.browserPool = [];
    this.maxBrowsers = 3;
    this.activeJobs = new Map();
    this.cronJobs = new Map();
    this.userAgentGenerator = new UserAgent({ deviceCategory: 'desktop' });
    
    // Anti-détection avancée
    this.antiDetectionConfig = {
      viewport: {
        width: 1920 + Math.floor(Math.random() * 100),
        height: 1080 + Math.floor(Math.random() * 100)
      },
      randomDelays: {
        min: 1000,
        max: 5000
      },
      humanLikeActions: true,
      stealthMode: true
    };

    // URLs Vinted par pays
    this.vintedDomains = {
      'fr': 'https://www.vinted.fr',
      'be': 'https://www.vinted.be', 
      'de': 'https://www.vinted.de',
      'es': 'https://www.vinted.es',
      'it': 'https://www.vinted.it',
      'nl': 'https://www.vinted.nl',
      'pl': 'https://www.vinted.pl',
      'cz': 'https://www.vinted.cz',
      'lt': 'https://www.vinted.lt',
      'lv': 'https://www.vinted.lv',
      'lu': 'https://www.vinted.lu',
      'at': 'https://www.vinted.at'
    };
  }

  async createBrowser(proxyConfig = null) {
    try {
      const userAgent = this.userAgentGenerator.toString();
      
      const launchOptions = {
        headless: true,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-accelerated-2d-canvas',
          '--no-first-run',
          '--no-zygote',
          '--disable-gpu',
          '--disable-background-timer-throttling',
          '--disable-backgrounding-occluded-windows',
          '--disable-renderer-backgrounding',
          '--disable-features=TranslateUI',
          '--disable-ipc-flooding-protection',
          '--disable-blink-features=AutomationControlled',
          '--disable-web-security',
          '--disable-features=VizDisplayCompositor',
          `--user-agent=${userAgent}`,
          '--window-size=1920,1080'
        ]
      };

      // Configuration du proxy si disponible
      if (proxyConfig && proxyConfig.proxy) {
        const proxy = proxyConfig.proxy;
        launchOptions.args.push(`--proxy-server=${proxy.protocol}://${proxy.host}:${proxy.port}`);
        
        if (proxy.auth) {
          launchOptions.args.push(`--proxy-auth=${proxy.auth.username}:${proxy.auth.password}`);
        }
      }

      const browser = await puppeteer.launch(launchOptions);
      
      // Configuration anti-détection avancée
      const pages = await browser.pages();
      const page = pages[0] || await browser.newPage();
      
      await this.setupAntiDetection(page, userAgent);
      
      return { browser, page, userAgent, proxyInfo: proxyConfig?.proxyInfo };
    } catch (error) {
      logger.error('Erreur lors de la création du navigateur:', error);
      throw error;
    }
  }

  async setupAntiDetection(page, userAgent) {
    // Masquer les traces d'automation
    await page.evaluateOnNewDocument(() => {
      // Redéfinir webdriver
      Object.defineProperty(navigator, 'webdriver', {
        get: () => undefined,
      });

      // Masquer les propriétés d'automation
      delete window.chrome?.runtime?.onConnect;
      delete window.chrome?.runtime?.onMessage;

      // Simuler des plugins réalistes
      Object.defineProperty(navigator, 'plugins', {
        get: () => [
          {
            0: { type: "application/x-google-chrome-pdf", suffixes: "pdf", description: "Portable Document Format", enabledPlugin: Plugin },
            description: "Portable Document Format",
            filename: "internal-pdf-viewer",
            length: 1,
            name: "Chrome PDF Plugin"
          },
          {
            0: { type: "application/pdf", suffixes: "pdf", description: "", enabledPlugin: Plugin },
            description: "",
            filename: "mhjfbmdgcfjbbpaeojofohoefgiehjai",
            length: 1,
            name: "Chrome PDF Viewer"
          }
        ]
      });

      // Redéfinir les langues
      Object.defineProperty(navigator, 'languages', {
        get: () => ['fr-FR', 'fr', 'en-US', 'en']
      });

      // Masquer les fuites de mémoire automation
      const originalQuery = window.navigator.permissions.query;
      window.navigator.permissions.query = (parameters) => (
        parameters.name === 'notifications' ?
          Promise.resolve({ state: Notification.permission }) :
          originalQuery(parameters)
      );

      // Simuler une résolution d'écran réaliste
      Object.defineProperty(screen, 'width', { get: () => 1920 });
      Object.defineProperty(screen, 'height', { get: () => 1080 });
      Object.defineProperty(screen, 'availWidth', { get: () => 1920 });
      Object.defineProperty(screen, 'availHeight', { get: () => 1040 });
    });

    // Configuration viewport avec randomisation
    await page.setViewport({
      width: this.antiDetectionConfig.viewport.width,
      height: this.antiDetectionConfig.viewport.height,
      deviceScaleFactor: 1,
      hasTouch: false,
      isLandscape: true,
      isMobile: false
    });

    // Headers HTTP réalistes
    await page.setUserAgent(userAgent);
    await page.setExtraHTTPHeaders({
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
      'Accept-Encoding': 'gzip, deflate, br',
      'Accept-Language': 'fr-FR,fr;q=0.9,en-US;q=0.8,en;q=0.7',
      'Cache-Control': 'max-age=0',
      'sec-ch-ua': '"Chromium";v="119", "Google Chrome";v="119", "Not?A_Brand";v="24"',
      'sec-ch-ua-mobile': '?0',
      'sec-ch-ua-platform': '"Windows"',
      'Sec-Fetch-Dest': 'document',
      'Sec-Fetch-Mode': 'navigate',
      'Sec-Fetch-Site': 'none',
      'Sec-Fetch-User': '?1',
      'Upgrade-Insecure-Requests': '1'
    });

    // Intercepter et modifier les requêtes si nécessaire
    await page.setRequestInterception(true);
    page.on('request', (request) => {
      // Bloquer les requêtes de tracking
      const blockedDomains = [
        'google-analytics.com',
        'googletagmanager.com',
        'facebook.com',
        'doubleclick.net',
        'googlesyndication.com'
      ];

      const url = request.url();
      if (blockedDomains.some(domain => url.includes(domain))) {
        request.abort();
      } else {
        request.continue();
      }
    });
  }

  async authenticateUser(credentials) {
    const { email, password, country, userAgent, proxy } = credentials;
    let browser, page;

    try {
      logger.info(`🔐 Tentative de connexion Vinted pour ${email}`);

      // Créer le navigateur avec proxy si disponible
      const proxyConfig = proxy ? await this.proxyManager.createProxyAgent() : null;
      const browserData = await this.createBrowser(proxyConfig);
      
      browser = browserData.browser;
      page = browserData.page;

      const baseUrl = this.vintedDomains[country] || this.vintedDomains['fr'];
      
      // Aller à la page de connexion
      await page.goto(`${baseUrl}/auth/login`, { 
        waitUntil: 'networkidle2',
        timeout: 30000
      });

      // Attendre que la page soit chargée
      await this.randomDelay(2000, 4000);

      // Gérer les cookies
      await this.handleCookieConsent(page);

      // Remplir le formulaire de connexion
      await page.waitForSelector('input[type="email"], input[name="login"], #login_email', { timeout: 10000 });
      
      // Saisir l'email avec simulation humaine
      const emailSelector = await page.$('input[type="email"], input[name="login"], #login_email');
      await this.humanLikeTyping(page, emailSelector, email);
      
      await this.randomDelay(500, 1500);

      // Saisir le mot de passe
      const passwordSelector = await page.$('input[type="password"], input[name="password"], #login_password');
      await this.humanLikeTyping(page, passwordSelector, password);

      await this.randomDelay(1000, 2000);

      // Cliquer sur le bouton de connexion
      const submitButton = await page.$('button[type="submit"], .btn-primary, [data-testid="login-button"]');
      if (submitButton) {
        await this.humanLikeClick(page, submitButton);
      } else {
        // Fallback: presser Entrée
        await page.keyboard.press('Enter');
      }

      // Attendre la redirection ou l'erreur
      await page.waitForNavigation({ 
        waitUntil: 'networkidle2', 
        timeout: 15000 
      }).catch(() => {
        // La navigation peut échouer si déjà sur la bonne page
      });

      // Vérifier si la connexion a réussi
      const isLoggedIn = await this.checkLoginSuccess(page, baseUrl);
      
      if (isLoggedIn.success) {
        // Récupérer les cookies de session
        const cookies = await page.cookies();
        
        // Récupérer l'ID utilisateur Vinted
        const vintedUserId = await this.extractVintedUserId(page);

        // Marquer le proxy comme réussi si utilisé
        if (proxyConfig?.proxyInfo) {
          this.proxyManager.markProxyAsSuccessful(proxyConfig.proxyInfo.id);
        }

        logger.info(`✅ Connexion réussie pour ${email}`);
        
        return {
          success: true,
          vintedUserId,
          cookies,
          userAgent: browserData.userAgent,
          message: 'Connexion réussie'
        };
      } else {
        throw new Error(isLoggedIn.error || 'Échec de la connexion');
      }

    } catch (error) {
      logger.error(`❌ Erreur lors de l'authentification pour ${email}:`, error);
      
      // Marquer le proxy comme défaillant si utilisé
      if (browser && page) {
        const proxyConfig = await this.proxyManager.createProxyAgent();
        if (proxyConfig?.proxyInfo) {
          this.proxyManager.markProxyAsFailed(proxyConfig.proxyInfo.id);
        }
      }

      return {
        success: false,
        error: error.message,
        message: 'Échec de la connexion'
      };
    } finally {
      if (browser) {
        await browser.close();
      }
    }
  }

  async checkLoginSuccess(page, baseUrl) {
    try {
      // Vérifier plusieurs indicateurs de connexion réussie
      const indicators = [
        '.user-login', // Menu utilisateur
        '[data-testid="header-user-menu"]',
        '.user-avatar',
        '.header__user',
        'a[href*="/users/"]'
      ];

      for (const indicator of indicators) {
        try {
          await page.waitForSelector(indicator, { timeout: 5000 });
          return { success: true };
        } catch (e) {
          // Continuer vers le prochain indicateur
        }
      }

      // Vérifier si on est sur une page d'erreur
      const errorMessages = await page.$$eval('.error, .alert-danger, .notification--error', 
        elements => elements.map(el => el.textContent.trim())
      ).catch(() => []);

      if (errorMessages.length > 0) {
        return { success: false, error: errorMessages.join(', ') };
      }

      // Vérifier l'URL
      const currentUrl = page.url();
      if (currentUrl.includes('/auth/login') || currentUrl.includes('/login')) {
        return { success: false, error: 'Toujours sur la page de connexion' };
      }

      // Si on arrive ici sans erreur, considérer comme réussi
      return { success: true };
      
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  async extractVintedUserId(page) {
    try {
      // Plusieurs méthodes pour extraire l'ID utilisateur
      
      // Méthode 1: depuis les scripts de la page
      const userIdFromScript = await page.evaluate(() => {
        const scripts = document.querySelectorAll('script');
        for (const script of scripts) {
          const content = script.textContent;
          if (content && content.includes('current_user')) {
            const match = content.match(/"current_user":\s*{\s*"id":\s*(\d+)/);
            if (match) return match[1];
          }
        }
        return null;
      });

      if (userIdFromScript) return userIdFromScript;

      // Méthode 2: depuis les liens de profil
      const userIdFromProfile = await page.evaluate(() => {
        const profileLinks = document.querySelectorAll('a[href*="/users/"]');
        for (const link of profileLinks) {
          const href = link.getAttribute('href');
          const match = href.match(/\/users\/(\d+)/);
          if (match) return match[1];
        }
        return null;
      });

      if (userIdFromProfile) return userIdFromProfile;

      // Méthode 3: depuis les métadonnées
      const userIdFromMeta = await page.evaluate(() => {
        const metaTags = document.querySelectorAll('meta[name*="user"], meta[property*="user"]');
        for (const meta of metaTags) {
          const content = meta.getAttribute('content');
          if (content && /^\d+$/.test(content)) {
            return content;
          }
        }
        return null;
      });

      return userIdFromMeta || 'unknown';
      
    } catch (error) {
      logger.warn('Impossible d\'extraire l\'ID utilisateur Vinted:', error);
      return 'unknown';
    }
  }

  async handleCookieConsent(page) {
    try {
      // Attendre et accepter les cookies si nécessaire
      const cookieSelectors = [
        '.cookie-consent button',
        '[data-testid="cookie-consent-accept"]',
        '.gdpr-button',
        '#onetrust-accept-btn-handler',
        '.accept-cookies'
      ];

      for (const selector of cookieSelectors) {
        try {
          const button = await page.$(selector);
          if (button) {
            await this.humanLikeClick(page, button);
            await this.randomDelay(1000, 2000);
            break;
          }
        } catch (e) {
          // Continuer vers le prochain sélecteur
        }
      }
    } catch (error) {
      // Ignorer les erreurs de cookies - pas critique
    }
  }

  async humanLikeTyping(page, element, text) {
    // Simuler une saisie humaine
    await element.click();
    await this.randomDelay(100, 300);
    
    // Effacer le contenu existant
    await element.evaluate(el => el.value = '');
    
    // Taper caractère par caractère avec des délais variables
    for (const char of text) {
      await element.type(char);
      await this.randomDelay(50, 150);
    }
  }

  async humanLikeClick(page, element) {
    // Simuler un clic humain avec mouvement de souris
    const box = await element.boundingBox();
    if (box) {
      const x = box.x + Math.random() * box.width;
      const y = box.y + Math.random() * box.height;
      
      await page.mouse.move(x, y, { steps: Math.floor(Math.random() * 5) + 1 });
      await this.randomDelay(100, 300);
      await page.mouse.click(x, y);
    } else {
      await element.click();
    }
  }

  async randomDelay(min = 1000, max = 3000) {
    const delay = Math.floor(Math.random() * (max - min + 1)) + min;
    await new Promise(resolve => setTimeout(resolve, delay));
  }

  async repostItem(user, itemId, itemUrl) {
    let browser, page;
    const startTime = Date.now();

    try {
      logger.info(`🔄 Début du repost pour l'article ${itemId}`);

      // Créer le navigateur avec proxy
      const proxyConfig = await this.proxyManager.createProxyAgent();
      const browserData = await this.createBrowser(proxyConfig);
      
      browser = browserData.browser;
      page = browserData.page;

      // Aller sur la page de l'article
      await page.goto(itemUrl, { 
        waitUntil: 'networkidle2',
        timeout: 30000
      });

      // Restaurer les cookies de session
      if (user.cookies && user.cookies.length > 0) {
        await page.setCookie(...user.cookies);
        await page.reload({ waitUntil: 'networkidle2' });
      }

      await this.randomDelay(2000, 4000);

      // Vérifier si l'utilisateur est toujours connecté
      const isLoggedIn = await this.checkLoginSuccess(page, this.vintedDomains[user.country]);
      if (!isLoggedIn.success) {
        throw new Error('Session expirée, reconnexion nécessaire');
      }

      // Chercher le bouton de repost/boost
      const repostSelectors = [
        '[data-testid="item-bump-button"]',
        '.bump-button',
        'button[title*="boost"]',
        'button[title*="remonter"]',
        '.item-actions button',
        'a[href*="bump"]'
      ];

      let repostButton = null;
      for (const selector of repostSelectors) {
        try {
          repostButton = await page.$(selector);
          if (repostButton) break;
        } catch (e) {
          continue;
        }
      }

      if (!repostButton) {
        // Essayer de naviguer vers la page de gestion
        await page.goto(`${this.vintedDomains[user.country]}/items/${itemId}/edit`, {
          waitUntil: 'networkidle2'
        });
        await this.randomDelay(2000, 3000);

        // Chercher le bouton dans la page d'édition
        for (const selector of repostSelectors) {
          try {
            repostButton = await page.$(selector);
            if (repostButton) break;
          } catch (e) {
            continue;
          }
        }
      }

      if (repostButton) {
        // Simuler un comportement humain avant le clic
        await this.simulateHumanBehavior(page);
        
        // Cliquer sur le bouton de repost
        await this.humanLikeClick(page, repostButton);
        
        await this.randomDelay(2000, 4000);

        // Confirmer si nécessaire
        const confirmButton = await page.$('button[data-testid="confirm"], .btn-primary, button:contains("Confirmer")');
        if (confirmButton) {
          await this.humanLikeClick(page, confirmButton);
          await this.randomDelay(2000, 3000);
        }

        // Vérifier le succès du repost
        const success = await this.verifyRepostSuccess(page);
        
        if (success) {
          const executionTime = Date.now() - startTime;
          
          // Marquer le proxy comme réussi
          if (proxyConfig?.proxyInfo) {
            this.proxyManager.markProxyAsSuccessful(proxyConfig.proxyInfo.id);
          }

          logger.info(`✅ Repost réussi pour l'article ${itemId} en ${executionTime}ms`);
          
          return {
            success: true,
            message: 'Article reposté avec succès',
            executionTime,
            proxyUsed: proxyConfig?.proxyInfo?.id || 'direct'
          };
        } else {
          throw new Error('Échec de la vérification du repost');
        }
      } else {
        throw new Error('Bouton de repost introuvable');
      }

    } catch (error) {
      logger.error(`❌ Erreur lors du repost de l'article ${itemId}:`, error);
      
      // Marquer le proxy comme défaillant
      const proxyConfig = await this.proxyManager.createProxyAgent();
      if (proxyConfig?.proxyInfo) {
        this.proxyManager.markProxyAsFailed(proxyConfig.proxyInfo.id);
      }

      return {
        success: false,
        message: error.message,
        executionTime: Date.now() - startTime,
        proxyUsed: proxyConfig?.proxyInfo?.id || 'direct'
      };
    } finally {
      if (browser) {
        await browser.close();
      }
    }
  }

  async simulateHumanBehavior(page) {
    // Simuler un comportement humain réaliste
    const actions = [
      async () => {
        // Mouvement de souris aléatoire
        await page.mouse.move(
          Math.random() * 1920,
          Math.random() * 1080,
          { steps: Math.floor(Math.random() * 3) + 1 }
        );
      },
      async () => {
        // Scroll aléatoire
        await page.evaluate(() => {
          window.scrollBy(0, Math.random() * 200 - 100);
        });
      },
      async () => {
        // Attente aléatoire
        await this.randomDelay(500, 1500);
      }
    ];

    // Exécuter 1-3 actions aléatoires
    const numActions = Math.floor(Math.random() * 3) + 1;
    for (let i = 0; i < numActions; i++) {
      const action = actions[Math.floor(Math.random() * actions.length)];
      await action();
    }
  }

  async verifyRepostSuccess(page) {
    try {
      // Chercher des indicateurs de succès
      const successIndicators = [
        '.success-message',
        '.alert-success',
        '[data-testid="success-notification"]',
        '.notification--success'
      ];

      for (const indicator of successIndicators) {
        try {
          await page.waitForSelector(indicator, { timeout: 5000 });
          return true;
        } catch (e) {
          continue;
        }
      }

      // Vérifier dans le texte de la page
      const pageText = await page.evaluate(() => document.body.textContent);
      const successKeywords = ['reposté', 'boosted', 'remonté', 'success', 'réussi'];
      
      return successKeywords.some(keyword => 
        pageText.toLowerCase().includes(keyword.toLowerCase())
      );
      
    } catch (error) {
      logger.warn('Impossible de vérifier le succès du repost:', error);
      return false;
    }
  }

  async scheduleReposts(repostJob) {
    try {
      const { itemId, intervalle, nombreTotal, prochainRepost } = repostJob;
      
      // Créer un cron job pour ce repost
      const cronExpression = this.generateCronExpression(prochainRepost, intervalle);
      
      const job = cron.schedule(cronExpression, async () => {
        await this.executeScheduledRepost(repostJob);
      }, {
        scheduled: false,
        timezone: 'Europe/Paris'
      });

      this.cronJobs.set(itemId, job);
      job.start();
      
      logger.info(`📅 Repost programmé pour l'article ${itemId}`);
      
    } catch (error) {
      logger.error('Erreur lors de la programmation du repost:', error);
    }
  }

  generateCronExpression(nextDate, intervalHours) {
    const date = new Date(nextDate);
    const minute = date.getMinutes();
    const hour = date.getHours();
    
    // Cron pour répéter toutes les X heures à partir de l'heure spécifiée
    return `${minute} ${hour}/${intervalHours} * * *`;
  }

  async executeScheduledRepost(repostJob) {
    // Cette méthode sera appelée par le cron job
    // Implementation détaillée pour l'exécution automatique
    logger.info(`🔄 Exécution du repost programmé pour ${repostJob.itemId}`);
    // TODO: Implémenter la logique complète d'exécution
  }
}