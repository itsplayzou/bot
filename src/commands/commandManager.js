import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { logger } from '../index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export class CommandManager {
  constructor(bot) {
    this.bot = bot;
    this.commandsPath = path.join(__dirname, '.');
  }

  async loadCommands() {
    try {
      const commandFiles = fs.readdirSync(this.commandsPath)
        .filter(file => file.endsWith('.js') && file !== 'commandManager.js');

      logger.info(`🔄 Chargement de ${commandFiles.length} commandes...`);

      for (const file of commandFiles) {
        try {
          const filePath = path.join(this.commandsPath, file);
          const { default: command } = await import(`file://${filePath}`);
          
          if ('data' in command && 'execute' in command) {
            this.bot.commands.set(command.data.name, command);
            logger.info(`✅ Commande chargée: ${command.data.name}`);
          } else {
            logger.warn(`⚠️ Commande invalide dans ${file}: propriétés 'data' ou 'execute' manquantes`);
          }
        } catch (error) {
          logger.error(`❌ Erreur lors du chargement de ${file}:`, error);
        }
      }

      logger.info(`✅ ${this.bot.commands.size} commandes chargées avec succès`);
    } catch (error) {
      logger.error('❌ Erreur lors du chargement des commandes:', error);
    }
  }
}