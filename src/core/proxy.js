import { ProxyChain } from 'proxy-chain';
import axios from 'axios';
import crypto from 'crypto';
import { logger } from '../index.js';

export class ProxyManager {
  constructor() {
    this.proxyList = [];
    this.currentProxyIndex = 0;
    this.proxyStats = new Map(); // Statistiques des proxies
    this.blacklistedProxies = new Set(); // Proxies défaillants
    this.rotationInterval = null;
    this.testResults = new Map();
    
    // Configuration des proxies résidentiels
    this.residentialConfig = {
      username: process.env.PROXY_USERNAME,
      password: process.env.PROXY_PASSWORD,
      endpoint: process.env.PROXY_ENDPOINT,
      port: process.env.PROXY_PORT || 8080,
      rotation: true,
      sessionDuration: 10 * 60 * 1000 // 10 minutes par session
    };

    // Liste de proxies gratuits de backup (moins fiables)
    this.backupProxies = [
      // Proxy list sera populate dynamiquement
    ];
  }

  async initialize() {
    try {
      logger.info('🔄 Initialisation du gestionnaire de proxies...');
      
      // Configurer les proxies résidentiels si disponibles
      if (this.residentialConfig.username && this.residentialConfig.endpoint) {
        await this.setupResidentialProxies();
      }
      
      // Charger les proxies de backup
      await this.loadBackupProxies();
      
      // Tester les proxies
      await this.testAllProxies();
      
      // Démarrer la rotation automatique
      this.startProxyRotation();
      
      logger.info(`✅ Gestionnaire de proxies initialisé avec ${this.proxyList.length} proxies actifs`);
    } catch (error) {
      logger.error('❌ Erreur lors de l\'initialisation des proxies:', error);
      // Continuer sans proxies en mode dégradé
      logger.warn('⚠️ Fonctionnement sans proxies (mode dégradé)');
    }
  }

  async setupResidentialProxies() {
    try {
      const { username, password, endpoint, port } = this.residentialConfig;
      
      // Créer plusieurs sessions pour la rotation
      for (let i = 0; i < 10; i++) {
        const sessionId = crypto.randomBytes(8).toString('hex');
        const proxyUrl = `http://${username}-session-${sessionId}:${password}@${endpoint}:${port}`;
        
        this.proxyList.push({
          id: `residential_${i}`,
          url: proxyUrl,
          type: 'residential',
          sessionId: sessionId,
          isActive: true,
          successRate: 100,
          lastUsed: null,
          responseTime: 0,
          location: 'rotating',
          priority: 10 // Haute priorité pour les proxies résidentiels
        });
      }
      
      logger.info(`✅ ${this.proxyList.length} proxies résidentiels configurés`);
    } catch (error) {
      logger.error('Erreur lors de la configuration des proxies résidentiels:', error);
    }
  }

  async loadBackupProxies() {
    try {
      // API pour récupérer des proxies gratuits (moins fiables)
      const freeProxyAPIs = [
        'https://api.proxyscrape.com/v2/?request=get&protocol=http&timeout=10000&country=all&ssl=all&anonymity=all',
        'https://raw.githubusercontent.com/clarketm/proxy-list/master/proxy-list-raw.txt',
        'https://raw.githubusercontent.com/TheSpeedX/PROXY-List/master/http.txt'
      ];

      for (const apiUrl of freeProxyAPIs) {
        try {
          const response = await axios.get(apiUrl, { timeout: 10000 });
          const proxies = response.data.split('\n')
            .filter(line => line.trim() && line.includes(':'))
            .slice(0, 20); // Limiter à 20 proxies par source

          for (const proxyLine of proxies) {
            const [ip, port] = proxyLine.trim().split(':');
            if (ip && port && this.isValidIP(ip)) {
              this.proxyList.push({
                id: `backup_${ip}_${port}`,
                url: `http://${ip}:${port}`,
                type: 'free',
                isActive: true,
                successRate: 50, // Taux de succès initial plus bas
                lastUsed: null,
                responseTime: 0,
                location: 'unknown',
                priority: 1 // Basse priorité pour les proxies gratuits
              });
            }
          }
        } catch (apiError) {
          logger.warn(`⚠️ Impossible de charger les proxies depuis ${apiUrl}`);
        }
      }

      logger.info(`✅ ${this.proxyList.filter(p => p.type === 'free').length} proxies de backup chargés`);
    } catch (error) {
      logger.error('Erreur lors du chargement des proxies de backup:', error);
    }
  }

  async testAllProxies() {
    logger.info('🧪 Test de tous les proxies...');
    
    const testPromises = this.proxyList.map(proxy => this.testProxy(proxy));
    const results = await Promise.allSettled(testPromises);
    
    let activeCount = 0;
    results.forEach((result, index) => {
      if (result.status === 'fulfilled' && result.value) {
        activeCount++;
      } else {
        this.proxyList[index].isActive = false;
        this.blacklistedProxies.add(this.proxyList[index].id);
      }
    });

    // Trier par priorité et taux de succès
    this.proxyList.sort((a, b) => {
      if (a.priority !== b.priority) return b.priority - a.priority;
      return b.successRate - a.successRate;
    });

    logger.info(`✅ Test terminé: ${activeCount}/${this.proxyList.length} proxies actifs`);
  }

  async testProxy(proxy, testUrl = 'https://httpbin.org/ip') {
    try {
      const startTime = Date.now();
      
      const response = await axios.get(testUrl, {
        proxy: this.parseProxyUrl(proxy.url),
        timeout: 10000,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
      });

      const responseTime = Date.now() - startTime;
      
      // Mettre à jour les statistiques
      proxy.responseTime = responseTime;
      proxy.successRate = Math.min(100, proxy.successRate + 1);
      proxy.isActive = true;
      
      this.testResults.set(proxy.id, {
        success: true,
        responseTime,
        timestamp: Date.now()
      });

      return true;
    } catch (error) {
      proxy.successRate = Math.max(0, proxy.successRate - 5);
      proxy.isActive = proxy.successRate > 20; // Désactiver si taux < 20%
      
      this.testResults.set(proxy.id, {
        success: false,
        error: error.message,
        timestamp: Date.now()
      });

      return false;
    }
  }

  parseProxyUrl(proxyUrl) {
    try {
      const url = new URL(proxyUrl);
      return {
        protocol: url.protocol.replace(':', ''),
        host: url.hostname,
        port: parseInt(url.port),
        auth: url.username && url.password ? {
          username: url.username,
          password: url.password
        } : undefined
      };
    } catch (error) {
      logger.error('Erreur lors du parsing de l\'URL du proxy:', error);
      return null;
    }
  }

  getNextProxy() {
    // Filtrer les proxies actifs
    const activeProxies = this.proxyList.filter(p => 
      p.isActive && !this.blacklistedProxies.has(p.id)
    );

    if (activeProxies.length === 0) {
      logger.warn('⚠️ Aucun proxy actif disponible');
      return null;
    }

    // Stratégie de sélection intelligente
    const now = Date.now();
    const availableProxies = activeProxies.filter(p => 
      !p.lastUsed || (now - p.lastUsed > 30000) // 30 secondes de cooldown
    );

    let selectedProxy;
    if (availableProxies.length > 0) {
      // Choisir un proxy avec rotation pondérée
      const weights = availableProxies.map(p => p.priority * p.successRate / 100);
      selectedProxy = this.weightedRandomSelect(availableProxies, weights);
    } else {
      // Prendre le proxy le moins récemment utilisé
      selectedProxy = activeProxies.reduce((oldest, current) => 
        (!oldest.lastUsed || current.lastUsed < oldest.lastUsed) ? current : oldest
      );
    }

    // Mettre à jour l'heure d'utilisation
    selectedProxy.lastUsed = now;
    
    return selectedProxy;
  }

  weightedRandomSelect(items, weights) {
    const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
    let random = Math.random() * totalWeight;
    
    for (let i = 0; i < items.length; i++) {
      random -= weights[i];
      if (random <= 0) {
        return items[i];
      }
    }
    
    return items[items.length - 1];
  }

  async createProxyAgent(targetUrl) {
    const proxy = this.getNextProxy();
    
    if (!proxy) {
      logger.warn('⚠️ Aucun proxy disponible, utilisation de la connexion directe');
      return null;
    }

    try {
      // Utiliser proxy-chain pour créer un tunnel sécurisé
      const proxyConfig = this.parseProxyUrl(proxy.url);
      
      if (proxy.type === 'residential' && this.residentialConfig.rotation) {
        // Régénérer la session pour les proxies résidentiels
        const newSessionId = crypto.randomBytes(8).toString('hex');
        proxy.sessionId = newSessionId;
        proxy.url = proxy.url.replace(/session-[a-f0-9]+/, `session-${newSessionId}`);
      }

      logger.info(`🌐 Utilisation du proxy: ${proxy.id} (${proxy.type})`);
      
      return {
        proxy: proxyConfig,
        proxyInfo: proxy
      };
    } catch (error) {
      logger.error(`❌ Erreur lors de la création de l'agent proxy pour ${proxy.id}:`, error);
      this.markProxyAsFailed(proxy.id);
      return null;
    }
  }

  markProxyAsFailed(proxyId) {
    const proxy = this.proxyList.find(p => p.id === proxyId);
    if (proxy) {
      proxy.successRate = Math.max(0, proxy.successRate - 10);
      if (proxy.successRate < 10) {
        proxy.isActive = false;
        this.blacklistedProxies.add(proxyId);
        logger.warn(`🚫 Proxy ${proxyId} mis en liste noire`);
      }
    }
  }

  markProxyAsSuccessful(proxyId) {
    const proxy = this.proxyList.find(p => p.id === proxyId);
    if (proxy) {
      proxy.successRate = Math.min(100, proxy.successRate + 2);
      if (proxy.successRate > 50 && this.blacklistedProxies.has(proxyId)) {
        this.blacklistedProxies.delete(proxyId);
        proxy.isActive = true;
        logger.info(`✅ Proxy ${proxyId} réhabilité`);
      }
    }
  }

  startProxyRotation() {
    // Test périodique des proxies
    this.rotationInterval = setInterval(async () => {
      try {
        // Retester les proxies défaillants
        const failedProxies = this.proxyList.filter(p => !p.isActive);
        if (failedProxies.length > 0) {
          logger.info(`🔄 Retest de ${failedProxies.length} proxies défaillants...`);
          await Promise.allSettled(
            failedProxies.map(proxy => this.testProxy(proxy))
          );
        }

        // Charger de nouveaux proxies si nécessaire
        const activeCount = this.proxyList.filter(p => p.isActive).length;
        if (activeCount < 5) {
          logger.info('🔄 Rechargement de nouveaux proxies...');
          await this.loadBackupProxies();
        }

      } catch (error) {
        logger.error('Erreur lors de la rotation des proxies:', error);
      }
    }, 5 * 60 * 1000); // Toutes les 5 minutes
  }

  isValidIP(ip) {
    const ipRegex = /^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/;
    return ipRegex.test(ip);
  }

  getProxyStats() {
    const active = this.proxyList.filter(p => p.isActive).length;
    const residential = this.proxyList.filter(p => p.type === 'residential' && p.isActive).length;
    const avgSuccessRate = this.proxyList.reduce((sum, p) => sum + p.successRate, 0) / this.proxyList.length;

    return {
      total: this.proxyList.length,
      active,
      residential,
      blacklisted: this.blacklistedProxies.size,
      averageSuccessRate: Math.round(avgSuccessRate),
      averageResponseTime: Math.round(
        this.proxyList
          .filter(p => p.responseTime > 0)
          .reduce((sum, p, _, arr) => sum + p.responseTime / arr.length, 0)
      )
    };
  }

  async cleanup() {
    if (this.rotationInterval) {
      clearInterval(this.rotationInterval);
    }
    logger.info('✅ Gestionnaire de proxies nettoyé');
  }
}