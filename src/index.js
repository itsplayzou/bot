import { Client, GatewayIntentBits, Collection } from 'discord.js';
import { REST } from '@discordjs/rest';
import { Routes } from 'discord-api-types/v10';
import dotenv from 'dotenv';
import winston from 'winston';
import { DatabaseManager } from './core/database.js';
import { ProxyManager } from './core/proxy.js';
import { VintedManager } from './core/vinted.js';
import { SecurityManager } from './core/security.js';
import { CommandManager } from './commands/commandManager.js';
import { fileURLToPath } from 'url';
import path from 'path';

// Configuration
dotenv.config();
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Logger Elite Configuration
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.colorize(),
    winston.format.printf(({ level, message, timestamp, stack }) => {
      return `${timestamp} [${level}]: ${stack || message}`;
    })
  ),
  transports: [
    new winston.transports.Console(),
    new winston.transports.File({ filename: 'logs/error.log', level: 'error' }),
    new winston.transports.File({ filename: 'logs/combined.log' })
  ]
});

class VintedDiscordBot {
  constructor() {
    this.client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
      ]
    });

    this.commands = new Collection();
    this.isReady = false;
    
    // Managers Elite
    this.database = new DatabaseManager();
    this.proxy = new ProxyManager();
    this.vinted = new VintedManager(this.proxy);
    this.security = new SecurityManager();
    this.commandManager = new CommandManager(this);
    
    this.initializeBot();
  }

  async initializeBot() {
    try {
      logger.info('🚀 Initialisation du Bot Vinted Elite...');
      
      // Initialisation des managers
      await this.database.initialize();
      await this.proxy.initialize();
      await this.security.initialize();
      
      // Chargement des commandes
      await this.commandManager.loadCommands();
      
      // Événements Discord
      this.setupEventListeners();
      
      // Connexion
      await this.client.login(process.env.DISCORD_TOKEN);
      
    } catch (error) {
      logger.error('❌ Erreur lors de l\'initialisation:', error);
      process.exit(1);
    }
  }

  setupEventListeners() {
    this.client.once('ready', async () => {
      logger.info(`✅ Bot connecté en tant que ${this.client.user.tag}`);
      
      // Déploiement des commandes slash
      await this.deployCommands();
      
      this.client.user.setActivity('Vinted Elite Automation', { type: 'WATCHING' });
      this.isReady = true;
    });

    this.client.on('interactionCreate', async (interaction) => {
      if (!interaction.isChatInputCommand()) return;

      const command = this.commands.get(interaction.commandName);
      if (!command) return;

      try {
        // Vérification de sécurité
        const isAuthorized = await this.security.verifyUser(interaction.user.id);
        if (!isAuthorized) {
          await interaction.reply({ 
            content: '🔒 Accès non autorisé. Contactez un administrateur.', 
            ephemeral: true 
          });
          return;
        }

        // Rate limiting
        const canExecute = await this.security.checkRateLimit(interaction.user.id);
        if (!canExecute) {
          await interaction.reply({ 
            content: '⏱️ Vous exécutez les commandes trop rapidement. Attendez un moment.', 
            ephemeral: true 
          });
          return;
        }

        await command.execute(interaction, this);
        
        // Log de sécurité
        logger.info(`Commande exécutée: ${interaction.commandName} par ${interaction.user.tag}`);
        
      } catch (error) {
        logger.error(`Erreur lors de l'exécution de ${interaction.commandName}:`, error);
        
        const errorMsg = '❌ Une erreur s\'est produite lors de l\'exécution de la commande.';
        
        if (interaction.replied || interaction.deferred) {
          await interaction.followUp({ content: errorMsg, ephemeral: true });
        } else {
          await interaction.reply({ content: errorMsg, ephemeral: true });
        }
      }
    });

    this.client.on('error', (error) => {
      logger.error('Erreur Discord:', error);
    });

    process.on('unhandledRejection', (error) => {
      logger.error('Rejection non gérée:', error);
    });

    process.on('SIGINT', async () => {
      logger.info('🛑 Arrêt du bot...');
      await this.gracefulShutdown();
    });
  }

  async deployCommands() {
    try {
      const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
      
      const commands = Array.from(this.commands.values()).map(cmd => cmd.data.toJSON());
      
      logger.info(`🔄 Déploiement de ${commands.length} commandes...`);
      
      await rest.put(
        Routes.applicationGuildCommands(process.env.DISCORD_CLIENT_ID, process.env.DISCORD_GUILD_ID),
        { body: commands }
      );
      
      logger.info('✅ Commandes déployées avec succès!');
    } catch (error) {
      logger.error('❌ Erreur lors du déploiement des commandes:', error);
    }
  }

  async gracefulShutdown() {
    try {
      await this.database.close();
      await this.proxy.cleanup();
      this.client.destroy();
      logger.info('✅ Arrêt gracieux terminé');
      process.exit(0);
    } catch (error) {
      logger.error('❌ Erreur lors de l\'arrêt:', error);
      process.exit(1);
    }
  }
}

// Lancement du bot
new VintedDiscordBot();

export { logger };