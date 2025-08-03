import sqlite3 from 'sqlite3';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { logger } from '../index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export class DatabaseManager {
  constructor() {
    this.dbPath = process.env.DATABASE_PATH || path.join(__dirname, '../../data/users.db');
    this.encryptionKey = process.env.ENCRYPTION_KEY || crypto.randomBytes(32).toString('hex');
    this.algorithm = 'aes-256-gcm';
    this.db = null;
  }

  async initialize() {
    try {
      // Créer le dossier data s'il n'existe pas
      const dataDir = path.dirname(this.dbPath);
      if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
      }

      // Connexion à la base de données
      this.db = new sqlite3.Database(this.dbPath);
      
      // Activer les clés étrangères
      await this.run('PRAGMA foreign_keys = ON');
      
      // Créer les tables
      await this.createTables();
      
      logger.info('✅ Base de données initialisée avec succès');
    } catch (error) {
      logger.error('❌ Erreur lors de l\'initialisation de la base de données:', error);
      throw error;
    }
  }

  async createTables() {
    // Table des utilisateurs
    await this.run(`
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        discord_id TEXT UNIQUE NOT NULL,
        email_encrypted TEXT NOT NULL,
        password_encrypted TEXT NOT NULL,
        country TEXT NOT NULL,
        user_agent TEXT,
        proxy TEXT,
        vinted_user_id TEXT,
        cookies_encrypted TEXT,
        is_active BOOLEAN DEFAULT 1,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Table des jobs de repost
    await this.run(`
      CREATE TABLE IF NOT EXISTS repost_jobs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        discord_user_id TEXT NOT NULL,
        item_id TEXT NOT NULL,
        item_url TEXT NOT NULL,
        country TEXT NOT NULL,
        intervalle INTEGER NOT NULL,
        nombre_total INTEGER NOT NULL,
        nombre_effectue INTEGER DEFAULT 0,
        prochain_repost DATETIME NOT NULL,
        is_active BOOLEAN DEFAULT 1,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (discord_user_id) REFERENCES users (discord_id)
      )
    `);

    // Table des logs de repost
    await this.run(`
      CREATE TABLE IF NOT EXISTS repost_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        job_id INTEGER NOT NULL,
        discord_user_id TEXT NOT NULL,
        item_id TEXT NOT NULL,
        success BOOLEAN NOT NULL,
        message TEXT,
        proxy_used TEXT,
        user_agent_used TEXT,
        execution_time INTEGER,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (job_id) REFERENCES repost_jobs (id),
        FOREIGN KEY (discord_user_id) REFERENCES users (discord_id)
      )
    `);

    // Table de security (rate limiting, etc.)
    await this.run(`
      CREATE TABLE IF NOT EXISTS security_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        discord_user_id TEXT NOT NULL,
        action TEXT NOT NULL,
        ip_address TEXT,
        user_agent TEXT,
        success BOOLEAN NOT NULL,
        message TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Index pour optimiser les performances
    await this.run('CREATE INDEX IF NOT EXISTS idx_users_discord_id ON users (discord_id)');
    await this.run('CREATE INDEX IF NOT EXISTS idx_repost_jobs_user_id ON repost_jobs (discord_user_id)');
    await this.run('CREATE INDEX IF NOT EXISTS idx_repost_jobs_active ON repost_jobs (is_active, prochain_repost)');
    await this.run('CREATE INDEX IF NOT EXISTS idx_security_logs_user_id ON security_logs (discord_user_id)');
  }

  // Méthodes de chiffrement
  encrypt(text) {
    if (!text) return null;
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipher(this.algorithm, this.encryptionKey);
    cipher.setAutoPadding(true);
    
    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    
    const authTag = cipher.getAuthTag();
    return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`;
  }

  decrypt(encryptedText) {
    if (!encryptedText) return null;
    try {
      const [ivHex, authTagHex, encrypted] = encryptedText.split(':');
      const iv = Buffer.from(ivHex, 'hex');
      const authTag = Buffer.from(authTagHex, 'hex');
      
      const decipher = crypto.createDecipher(this.algorithm, this.encryptionKey);
      decipher.setAuthTag(authTag);
      decipher.setAutoPadding(true);
      
      let decrypted = decipher.update(encrypted, 'hex', 'utf8');
      decrypted += decipher.final('utf8');
      
      return decrypted;
    } catch (error) {
      logger.error('Erreur de déchiffrement:', error);
      return null;
    }
  }

  // Méthodes de base de données
  run(sql, params = []) {
    return new Promise((resolve, reject) => {
      this.db.run(sql, params, function(err) {
        if (err) {
          logger.error('Erreur SQL (run):', err);
          reject(err);
        } else {
          resolve({ id: this.lastID, changes: this.changes });
        }
      });
    });
  }

  get(sql, params = []) {
    return new Promise((resolve, reject) => {
      this.db.get(sql, params, (err, row) => {
        if (err) {
          logger.error('Erreur SQL (get):', err);
          reject(err);
        } else {
          resolve(row);
        }
      });
    });
  }

  all(sql, params = []) {
    return new Promise((resolve, reject) => {
      this.db.all(sql, params, (err, rows) => {
        if (err) {
          logger.error('Erreur SQL (all):', err);
          reject(err);
        } else {
          resolve(rows);
        }
      });
    });
  }

  // Méthodes utilisateur
  async saveUser(userData) {
    try {
      const {
        discordId,
        email,
        password,
        country,
        userAgent,
        proxy,
        vintedUserId,
        cookies,
        isActive = true
      } = userData;

      // Chiffrer les données sensibles
      const emailEncrypted = this.encrypt(email);
      const passwordEncrypted = this.encrypt(password);
      const cookiesEncrypted = cookies ? this.encrypt(JSON.stringify(cookies)) : null;

      const result = await this.run(`
        INSERT OR REPLACE INTO users 
        (discord_id, email_encrypted, password_encrypted, country, user_agent, proxy, vinted_user_id, cookies_encrypted, is_active, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      `, [discordId, emailEncrypted, passwordEncrypted, country, userAgent, proxy, vintedUserId, cookiesEncrypted, isActive]);

      logger.info(`Utilisateur sauvegardé: ${discordId}`);
      return result;
    } catch (error) {
      logger.error('Erreur lors de la sauvegarde utilisateur:', error);
      throw error;
    }
  }

  async getUser(discordId) {
    try {
      const user = await this.get('SELECT * FROM users WHERE discord_id = ?', [discordId]);
      
      if (!user) return null;

      // Déchiffrer les données
      return {
        id: user.id,
        discordId: user.discord_id,
        email: this.decrypt(user.email_encrypted),
        password: this.decrypt(user.password_encrypted),
        country: user.country,
        userAgent: user.user_agent,
        proxy: user.proxy,
        vintedUserId: user.vinted_user_id,
        cookies: user.cookies_encrypted ? JSON.parse(this.decrypt(user.cookies_encrypted)) : null,
        isActive: Boolean(user.is_active),
        createdAt: new Date(user.created_at),
        updatedAt: new Date(user.updated_at)
      };
    } catch (error) {
      logger.error('Erreur lors de la récupération utilisateur:', error);
      throw error;
    }
  }

  async updateUser(discordId, updates) {
    try {
      const fieldsToUpdate = [];
      const values = [];

      // Gérer le chiffrement des champs sensibles
      if (updates.email) {
        fieldsToUpdate.push('email_encrypted = ?');
        values.push(this.encrypt(updates.email));
      }

      if (updates.password) {
        fieldsToUpdate.push('password_encrypted = ?');
        values.push(this.encrypt(updates.password));
      }

      if (updates.cookies) {
        fieldsToUpdate.push('cookies_encrypted = ?');
        values.push(this.encrypt(JSON.stringify(updates.cookies)));
      }

      // Champs non chiffrés
      const plainFields = ['country', 'user_agent', 'proxy', 'vinted_user_id', 'is_active'];
      plainFields.forEach(field => {
        if (updates[field] !== undefined) {
          fieldsToUpdate.push(`${field} = ?`);
          values.push(updates[field]);
        }
      });

      if (fieldsToUpdate.length === 0) return null;

      fieldsToUpdate.push('updated_at = CURRENT_TIMESTAMP');
      values.push(discordId);

      const result = await this.run(
        `UPDATE users SET ${fieldsToUpdate.join(', ')} WHERE discord_id = ?`,
        values
      );

      return result;
    } catch (error) {
      logger.error('Erreur lors de la mise à jour utilisateur:', error);
      throw error;
    }
  }

  // Méthodes de repost jobs
  async saveRepostJob(jobData) {
    try {
      const {
        discordUserId,
        itemId,
        itemUrl,
        country,
        intervalle,
        nombreTotal,
        nombreEffectue = 0,
        prochainRepost,
        isActive = true
      } = jobData;

      const result = await this.run(`
        INSERT INTO repost_jobs 
        (discord_user_id, item_id, item_url, country, intervalle, nombre_total, nombre_effectue, prochain_repost, is_active)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [discordUserId, itemId, itemUrl, country, intervalle, nombreTotal, nombreEffectue, prochainRepost.toISOString(), isActive]);

      return result;
    } catch (error) {
      logger.error('Erreur lors de la sauvegarde du job de repost:', error);
      throw error;
    }
  }

  async getActiveRepostJobs() {
    try {
      const jobs = await this.all(`
        SELECT * FROM repost_jobs 
        WHERE is_active = 1 AND prochain_repost <= datetime('now')
        ORDER BY prochain_repost ASC
      `);

      return jobs.map(job => ({
        id: job.id,
        discordUserId: job.discord_user_id,
        itemId: job.item_id,
        itemUrl: job.item_url,
        country: job.country,
        intervalle: job.intervalle,
        nombreTotal: job.nombre_total,
        nombreEffectue: job.nombre_effectue,
        prochainRepost: new Date(job.prochain_repost),
        isActive: Boolean(job.is_active),
        createdAt: new Date(job.created_at),
        updatedAt: new Date(job.updated_at)
      }));
    } catch (error) {
      logger.error('Erreur lors de la récupération des jobs actifs:', error);
      throw error;
    }
  }

  async updateRepostJob(itemId, updates) {
    try {
      const fieldsToUpdate = [];
      const values = [];

      const validFields = ['nombre_effectue', 'prochain_repost', 'is_active'];
      validFields.forEach(field => {
        if (updates[field] !== undefined) {
          fieldsToUpdate.push(`${field} = ?`);
          if (field === 'prochain_repost' && updates[field] instanceof Date) {
            values.push(updates[field].toISOString());
          } else {
            values.push(updates[field]);
          }
        }
      });

      if (fieldsToUpdate.length === 0) return null;

      fieldsToUpdate.push('updated_at = CURRENT_TIMESTAMP');
      values.push(itemId);

      const result = await this.run(
        `UPDATE repost_jobs SET ${fieldsToUpdate.join(', ')} WHERE item_id = ?`,
        values
      );

      return result;
    } catch (error) {
      logger.error('Erreur lors de la mise à jour du job de repost:', error);
      throw error;
    }
  }

  // Méthodes de logs
  async logRepost(logData) {
    try {
      const {
        jobId,
        discordUserId,
        itemId,
        success,
        message,
        proxyUsed,
        userAgentUsed,
        executionTime
      } = logData;

      const result = await this.run(`
        INSERT INTO repost_logs 
        (job_id, discord_user_id, item_id, success, message, proxy_used, user_agent_used, execution_time)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `, [jobId, discordUserId, itemId, success, message, proxyUsed, userAgentUsed, executionTime]);

      return result;
    } catch (error) {
      logger.error('Erreur lors de l\'enregistrement du log de repost:', error);
      throw error;
    }
  }

  async logSecurity(logData) {
    try {
      const {
        discordUserId,
        action,
        ipAddress,
        userAgent,
        success,
        message
      } = logData;

      const result = await this.run(`
        INSERT INTO security_logs 
        (discord_user_id, action, ip_address, user_agent, success, message)
        VALUES (?, ?, ?, ?, ?, ?)
      `, [discordUserId, action, ipAddress, userAgent, success, message]);

      return result;
    } catch (error) {
      logger.error('Erreur lors de l\'enregistrement du log de sécurité:', error);
      throw error;
    }
  }

  // Méthodes de nettoyage
  async cleanupOldLogs(daysToKeep = 30) {
    try {
      const cutoffDate = new Date(Date.now() - (daysToKeep * 24 * 60 * 60 * 1000));
      
      const repostResult = await this.run(
        'DELETE FROM repost_logs WHERE created_at < ?',
        [cutoffDate.toISOString()]
      );

      const securityResult = await this.run(
        'DELETE FROM security_logs WHERE created_at < ?',
        [cutoffDate.toISOString()]
      );

      logger.info(`Nettoyage terminé: ${repostResult.changes + securityResult.changes} logs supprimés`);
    } catch (error) {
      logger.error('Erreur lors du nettoyage des logs:', error);
    }
  }

  async close() {
    return new Promise((resolve) => {
      if (this.db) {
        this.db.close((err) => {
          if (err) {
            logger.error('Erreur lors de la fermeture de la base de données:', err);
          } else {
            logger.info('✅ Base de données fermée');
          }
          resolve();
        });
      } else {
        resolve();
      }
    });
  }
}