import { RateLimiterMemory } from 'rate-limiter-flexible';
import crypto from 'crypto';
import { logger } from '../index.js';

export class SecurityManager {
  constructor() {
    // Rate limiters par action
    this.rateLimiters = {
      login: new RateLimiterMemory({
        keyPrefix: 'login_attempt',
        points: 3, // 3 tentatives
        duration: 900, // 15 minutes
      }),
      repost: new RateLimiterMemory({
        keyPrefix: 'repost_action',
        points: 10, // 10 reposts
        duration: 3600, // 1 heure
      }),
      command: new RateLimiterMemory({
        keyPrefix: 'command_usage',
        points: 20, // 20 commandes
        duration: 300, // 5 minutes
      }),
      api: new RateLimiterMemory({
        keyPrefix: 'api_call',
        points: 100, // 100 appels API
        duration: 3600, // 1 heure
      })
    };

    // Liste des utilisateurs autorisés (sera gérée via base de données)
    this.authorizedUsers = new Set();
    this.adminUsers = new Set();
    
    // Blacklist temporaire
    this.blacklistedUsers = new Map();
    this.suspiciousActivity = new Map();
    
    // Configuration de sécurité
    this.securityConfig = {
      maxLoginAttempts: 3,
      maxRepostsPerHour: parseInt(process.env.MAX_REQUESTS_PER_HOUR) || 50,
      sessionTimeout: 24 * 60 * 60 * 1000, // 24 heures
      encryptionAlgorithm: 'aes-256-gcm',
      hashAlgorithm: 'sha256',
      saltRounds: 12
    };

    // Patterns de détection d'abus
    this.abusePatterns = {
      rapidCommands: { threshold: 10, timeWindow: 60000 }, // 10 commandes en 1 minute
      repeatedFailures: { threshold: 5, timeWindow: 300000 }, // 5 échecs en 5 minutes
      unusualActivity: { threshold: 50, timeWindow: 3600000 } // 50 actions en 1 heure
    };
  }

  async initialize() {
    try {
      logger.info('🔐 Initialisation du gestionnaire de sécurité...');
      
      // Charger les utilisateurs autorisés depuis la base de données
      await this.loadAuthorizedUsers();
      
      // Démarrer le nettoyage périodique
      this.startPeriodicCleanup();
      
      // Charger les admins depuis les variables d'environnement
      const adminIds = process.env.ADMIN_USER_IDS?.split(',') || [];
      adminIds.forEach(id => this.adminUsers.add(id.trim()));
      
      logger.info('✅ Gestionnaire de sécurité initialisé');
    } catch (error) {
      logger.error('❌ Erreur lors de l\'initialisation de la sécurité:', error);
      throw error;
    }
  }

  async loadAuthorizedUsers() {
    try {
      // Cette méthode sera connectée à la base de données
      // Pour l'instant, on charge depuis les variables d'environnement
      const userIds = process.env.AUTHORIZED_USER_IDS?.split(',') || [];
      userIds.forEach(id => this.authorizedUsers.add(id.trim()));
      
      logger.info(`📋 ${this.authorizedUsers.size} utilisateurs autorisés chargés`);
    } catch (error) {
      logger.error('Erreur lors du chargement des utilisateurs autorisés:', error);
    }
  }

  async verifyUser(userId) {
    try {
      // Vérifier si l'utilisateur est blacklisté
      if (this.isBlacklisted(userId)) {
        logger.warn(`🚫 Tentative d'accès d'un utilisateur blacklisté: ${userId}`);
        return false;
      }

      // Vérifier si l'utilisateur est admin (accès total)
      if (this.adminUsers.has(userId)) {
        return true;
      }

      // Vérifier si l'utilisateur est autorisé
      if (this.authorizedUsers.has(userId)) {
        return true;
      }

      // Mode ouvert : autoriser tous les utilisateurs par défaut
      // (peut être modifié selon les besoins de sécurité)
      if (process.env.SECURITY_MODE !== 'strict') {
        this.authorizedUsers.add(userId);
        return true;
      }

      return false;
    } catch (error) {
      logger.error('Erreur lors de la vérification utilisateur:', error);
      return false;
    }
  }

  async checkRateLimit(userId, action = 'command') {
    try {
      const rateLimiter = this.rateLimiters[action];
      if (!rateLimiter) {
        logger.warn(`Rate limiter non trouvé pour l'action: ${action}`);
        return true;
      }

      const result = await rateLimiter.consume(userId);
      
      // Log pour surveillance
      if (result.remainingPoints <= 2) {
        logger.warn(`⚠️ Utilisateur ${userId} approche de la limite pour ${action}: ${result.remainingPoints} tentatives restantes`);
        this.trackSuspiciousActivity(userId, action, 'rate_limit_warning');
      }

      return true;
    } catch (rejRes) {
      // Rate limit dépassé
      const timeRemaining = Math.round(rejRes.msBeforeNext / 1000);
      logger.warn(`🚫 Rate limit dépassé pour ${userId} sur ${action}. Réessai dans ${timeRemaining}s`);
      
      this.trackSuspiciousActivity(userId, action, 'rate_limit_exceeded');
      
      // Blacklister temporairement si abus répétés
      if (this.shouldTemporaryBlacklist(userId)) {
        this.addTemporaryBlacklist(userId, 'Abus répétés détectés');
      }

      return false;
    }
  }

  trackSuspiciousActivity(userId, action, type) {
    const key = `${userId}_${type}`;
    const now = Date.now();
    
    if (!this.suspiciousActivity.has(key)) {
      this.suspiciousActivity.set(key, []);
    }

    const activities = this.suspiciousActivity.get(key);
    activities.push({ timestamp: now, action, type });

    // Garder seulement les activités des dernières 24h
    const cutoff = now - (24 * 60 * 60 * 1000);
    this.suspiciousActivity.set(key, 
      activities.filter(activity => activity.timestamp > cutoff)
    );

    // Analyser les patterns d'abus
    this.analyzeAbusePatterns(userId, activities);
  }

  analyzeAbusePatterns(userId, activities) {
    const now = Date.now();

    // Vérifier les commandes rapides
    const recentCommands = activities.filter(
      a => now - a.timestamp < this.abusePatterns.rapidCommands.timeWindow
    );

    if (recentCommands.length >= this.abusePatterns.rapidCommands.threshold) {
      logger.warn(`🚨 Commandes rapides détectées pour ${userId}: ${recentCommands.length} en ${this.abusePatterns.rapidCommands.timeWindow/1000}s`);
      this.addTemporaryBlacklist(userId, 'Commandes trop rapides');
      return;
    }

    // Vérifier les échecs répétés
    const recentFailures = activities.filter(
      a => a.type.includes('failed') && now - a.timestamp < this.abusePatterns.repeatedFailures.timeWindow
    );

    if (recentFailures.length >= this.abusePatterns.repeatedFailures.threshold) {
      logger.warn(`🚨 Échecs répétés détectés pour ${userId}: ${recentFailures.length} en ${this.abusePatterns.repeatedFailures.timeWindow/1000}s`);
      this.addTemporaryBlacklist(userId, 'Échecs répétés');
      return;
    }

    // Vérifier l'activité inhabituelle
    const hourlyActivity = activities.filter(
      a => now - a.timestamp < this.abusePatterns.unusualActivity.timeWindow
    );

    if (hourlyActivity.length >= this.abusePatterns.unusualActivity.threshold) {
      logger.warn(`🚨 Activité inhabituelle détectée pour ${userId}: ${hourlyActivity.length} actions en 1h`);
      this.addTemporaryBlacklist(userId, 'Activité inhabituelle');
    }
  }

  shouldTemporaryBlacklist(userId) {
    const activities = this.suspiciousActivity.get(`${userId}_rate_limit_exceeded`) || [];
    const now = Date.now();
    const recentExceeds = activities.filter(a => now - a.timestamp < 300000); // 5 minutes

    return recentExceeds.length >= 3; // 3 dépassements en 5 minutes
  }

  addTemporaryBlacklist(userId, reason, duration = 30 * 60 * 1000) { // 30 minutes par défaut
    const expiresAt = Date.now() + duration;
    this.blacklistedUsers.set(userId, {
      reason,
      expiresAt,
      timestamp: Date.now()
    });

    logger.warn(`🚫 Utilisateur ${userId} temporairement blacklisté: ${reason} (expire dans ${duration/60000} minutes)`);
  }

  isBlacklisted(userId) {
    const blacklistEntry = this.blacklistedUsers.get(userId);
    if (!blacklistEntry) return false;

    // Vérifier si la blacklist a expiré
    if (Date.now() > blacklistEntry.expiresAt) {
      this.blacklistedUsers.delete(userId);
      logger.info(`✅ Blacklist expirée pour ${userId}`);
      return false;
    }

    return true;
  }

  removeFromBlacklist(userId) {
    if (this.blacklistedUsers.has(userId)) {
      this.blacklistedUsers.delete(userId);
      logger.info(`✅ Utilisateur ${userId} retiré de la blacklist`);
      return true;
    }
    return false;
  }

  // Méthodes de chiffrement et sécurité
  generateSecureToken(length = 32) {
    return crypto.randomBytes(length).toString('hex');
  }

  hashPassword(password, salt = null) {
    if (!salt) {
      salt = crypto.randomBytes(16).toString('hex');
    }
    const hash = crypto.pbkdf2Sync(password, salt, 10000, 64, 'sha512').toString('hex');
    return { hash, salt };
  }

  verifyPassword(password, hash, salt) {
    const { hash: newHash } = this.hashPassword(password, salt);
    return hash === newHash;
  }

  encryptData(data, key = null) {
    if (!key) {
      key = process.env.ENCRYPTION_KEY || this.generateSecureToken();
    }

    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipher('aes-256-gcm', key);
    
    let encrypted = cipher.update(JSON.stringify(data), 'utf8', 'hex');
    encrypted += cipher.final('hex');
    
    const authTag = cipher.getAuthTag();
    
    return {
      encrypted,
      iv: iv.toString('hex'),
      authTag: authTag.toString('hex')
    };
  }

  decryptData(encryptedData, key) {
    try {
      const { encrypted, iv, authTag } = encryptedData;
      
      const decipher = crypto.createDecipher('aes-256-gcm', key);
      decipher.setAuthTag(Buffer.from(authTag, 'hex'));
      
      let decrypted = decipher.update(encrypted, 'hex', 'utf8');
      decrypted += decipher.final('utf8');
      
      return JSON.parse(decrypted);
    } catch (error) {
      logger.error('Erreur lors du déchiffrement:', error);
      throw new Error('Impossible de déchiffrer les données');
    }
  }

  // Validation des entrées
  sanitizeInput(input) {
    if (typeof input !== 'string') return input;
    
    // Supprimer les caractères potentiellement dangereux
    return input
      .replace(/[<>\"']/g, '')
      .replace(/javascript:/gi, '')
      .replace(/on\w+=/gi, '')
      .trim();
  }

  validateEmail(email) {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  }

  validateUrl(url) {
    try {
      const urlObj = new URL(url);
      return ['http:', 'https:'].includes(urlObj.protocol);
    } catch {
      return false;
    }
  }

  // Surveillance et logs
  async logSecurityEvent(userId, action, success, details = {}) {
    const logEntry = {
      userId,
      action,
      success,
      timestamp: new Date().toISOString(),
      details,
      ip: details.ip || 'unknown',
      userAgent: details.userAgent || 'unknown'
    };

    logger.info(`🔐 Événement sécurité: ${action} par ${userId} - ${success ? 'Succès' : 'Échec'}`);
    
    // Ici on pourrait sauvegarder dans la base de données
    // await database.logSecurity(logEntry);
  }

  getSecurityStats() {
    const now = Date.now();
    const hourAgo = now - (60 * 60 * 1000);

    return {
      authorizedUsers: this.authorizedUsers.size,
      adminUsers: this.adminUsers.size,
      blacklistedUsers: this.blacklistedUsers.size,
      suspiciousActivities: Array.from(this.suspiciousActivity.entries())
        .filter(([key, activities]) => 
          activities.some(a => a.timestamp > hourAgo)
        ).length,
      rateLimitStatus: Object.fromEntries(
        Object.entries(this.rateLimiters).map(([key, limiter]) => [
          key,
          limiter.points
        ])
      )
    };
  }

  startPeriodicCleanup() {
    // Nettoyage toutes les heures
    setInterval(() => {
      this.cleanupExpiredEntries();
    }, 60 * 60 * 1000);

    logger.info('🧹 Nettoyage périodique de sécurité activé');
  }

  cleanupExpiredEntries() {
    const now = Date.now();
    let cleaned = 0;

    // Nettoyer les blacklists expirées
    for (const [userId, entry] of this.blacklistedUsers.entries()) {
      if (now > entry.expiresAt) {
        this.blacklistedUsers.delete(userId);
        cleaned++;
      }
    }

    // Nettoyer les activités suspectes anciennes
    for (const [key, activities] of this.suspiciousActivity.entries()) {
      const cutoff = now - (24 * 60 * 60 * 1000); // 24h
      const filtered = activities.filter(a => a.timestamp > cutoff);
      
      if (filtered.length === 0) {
        this.suspiciousActivity.delete(key);
        cleaned++;
      } else if (filtered.length !== activities.length) {
        this.suspiciousActivity.set(key, filtered);
      }
    }

    if (cleaned > 0) {
      logger.info(`🧹 Nettoyage sécurité: ${cleaned} entrées supprimées`);
    }
  }
}