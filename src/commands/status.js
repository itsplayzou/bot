import { SlashCommandBuilder, EmbedBuilder, ButtonBuilder, ButtonStyle, ActionRowBuilder } from 'discord.js';
import { logger } from '../index.js';

export default {
  data: new SlashCommandBuilder()
    .setName('status')
    .setDescription('📊 Voir l\'état de vos reposts et les statistiques du bot'),

  async execute(interaction, bot) {
    try {
      await interaction.deferReply({ ephemeral: true });

      // Récupérer les informations utilisateur
      const user = await bot.database.getUser(interaction.user.id);
      
      if (!user || !user.isActive) {
        const noAccountEmbed = new EmbedBuilder()
          .setColor('#FF0000')
          .setTitle('🔒 Aucun compte connecté')
          .setDescription('Vous devez d\'abord connecter votre compte Vinted avec `/login`')
          .addFields(
            { name: '🚀 Pour commencer', value: '1. Utilisez `/login` pour connecter votre compte\n2. Utilisez `/repost` pour automatiser vos annonces\n3. Utilisez `/status` pour suivre vos statistiques' }
          )
          .setFooter({ text: 'Vinted Elite Bot - Connectez-vous pour commencer' })
          .setTimestamp();

        await interaction.editReply({ embeds: [noAccountEmbed] });
        return;
      }

      // Récupérer les jobs de repost actifs
      const activeJobs = await bot.database.all(
        'SELECT * FROM repost_jobs WHERE discord_user_id = ? AND is_active = 1',
        [interaction.user.id]
      );

      // Récupérer les statistiques de repost
      const repostStats = await bot.database.all(`
        SELECT 
          COUNT(*) as total,
          SUM(CASE WHEN success = 1 THEN 1 ELSE 0 END) as successful,
          SUM(CASE WHEN success = 0 THEN 1 ELSE 0 END) as failed,
          AVG(execution_time) as avg_time,
          MAX(created_at) as last_repost
        FROM repost_logs 
        WHERE discord_user_id = ? 
        AND created_at > datetime('now', '-30 days')
      `, [interaction.user.id]);

      const stats = repostStats[0] || {
        total: 0,
        successful: 0,
        failed: 0,
        avg_time: 0,
        last_repost: null
      };

      // Statistiques du système
      const systemStats = {
        proxy: bot.proxy.getProxyStats(),
        security: bot.security.getSecurityStats()
      };

      // Créer l'embed principal
      const statusEmbed = new EmbedBuilder()
        .setColor('#00D9FF')
        .setTitle('📊 Tableau de bord Vinted Elite')
        .setDescription(`Bienvenue **${interaction.user.displayName}** ! Voici l'état de votre automation.`)
        .setThumbnail(interaction.user.displayAvatarURL({ dynamic: true }))
        .addFields(
          {
            name: '👤 Informations du compte',
            value: `**Email:** ||${user.email}||\n**Pays:** ${user.country.toUpperCase()}\n**Statut:** ${user.isActive ? '🟢 Actif' : '🔴 Inactif'}\n**Connecté le:** <t:${Math.floor(user.createdAt.getTime() / 1000)}:R>`,
            inline: true
          },
          {
            name: '🔄 Jobs de repost actifs',
            value: `**Total:** ${activeJobs.length}\n**En cours:** ${activeJobs.filter(j => new Date(j.prochain_repost) <= new Date()).length}\n**Programmés:** ${activeJobs.filter(j => new Date(j.prochain_repost) > new Date()).length}`,
            inline: true
          },
          {
            name: '📈 Statistiques (30 jours)',
            value: `**Total reposts:** ${stats.total || 0}\n**Réussis:** ${stats.successful || 0} (${stats.total ? Math.round((stats.successful / stats.total) * 100) : 0}%)\n**Échecs:** ${stats.failed || 0}\n**Temps moyen:** ${stats.avg_time ? Math.round(stats.avg_time) + 'ms' : 'N/A'}`,
            inline: true
          }
        );

      // Ajouter les détails des jobs actifs si disponibles
      if (activeJobs.length > 0) {
        const jobsDetails = activeJobs.slice(0, 5).map(job => {
          const nextRepost = new Date(job.prochain_repost);
          const isOverdue = nextRepost <= new Date();
          const status = isOverdue ? '🔴 En retard' : '🟡 Programmé';
          
          return `**[${job.item_id}](${job.item_url})** - ${job.nombre_effectue}/${job.nombre_total} (${status})
          ⏰ Prochain: <t:${Math.floor(nextRepost.getTime() / 1000)}:R>`;
        }).join('\n\n');

        statusEmbed.addFields({
          name: `🎯 Détails des reposts ${activeJobs.length > 5 ? `(${activeJobs.length - 5} autres)` : ''}`,
          value: jobsDetails || 'Aucun job actif',
          inline: false
        });
      }

      // Statistiques système
      statusEmbed.addFields(
        {
          name: '🌐 Proxies',
          value: `**Actifs:** ${systemStats.proxy.active}/${systemStats.proxy.total}\n**Résidentiels:** ${systemStats.proxy.residential}\n**Succès moyen:** ${systemStats.proxy.averageSuccessRate}%\n**Temps réponse:** ${systemStats.proxy.averageResponseTime}ms`,
          inline: true
        },
        {
          name: '🔐 Sécurité',
          value: `**Utilisateurs:** ${systemStats.security.authorizedUsers}\n**Blacklistés:** ${systemStats.security.blacklistedUsers}\n**Activités suspectes:** ${systemStats.security.suspiciousActivities}`,
          inline: true
        },
        {
          name: '⚡ Performance',
          value: `**Uptime:** <t:${Math.floor((Date.now() - (process.uptime() * 1000)) / 1000)}:R>\n**Mémoire:** ${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)}MB\n**Version:** 1.0.0 Elite`,
          inline: true
        }
      );

      if (stats.last_repost) {
        statusEmbed.setFooter({ 
          text: `Dernier repost: ${new Date(stats.last_repost).toLocaleString('fr-FR')} • Vinted Elite Bot`
        });
      } else {
        statusEmbed.setFooter({ text: 'Aucun repost effectué • Vinted Elite Bot' });
      }

      statusEmbed.setTimestamp();

      // Boutons d'action
      const buttons = new ActionRowBuilder()
        .addComponents(
          new ButtonBuilder()
            .setCustomId('refresh_status')
            .setLabel('🔄 Actualiser')
            .setStyle(ButtonStyle.Primary),
          new ButtonBuilder()
            .setCustomId('view_logs')
            .setLabel('📋 Voir les logs')
            .setStyle(ButtonStyle.Secondary),
          new ButtonBuilder()
            .setCustomId('manage_jobs')
            .setLabel('⚙️ Gérer les jobs')
            .setStyle(ButtonStyle.Secondary)
        );

      await interaction.editReply({ 
        embeds: [statusEmbed],
        components: [buttons]
      });

      // Gestionnaire des interactions avec les boutons
      const filter = (buttonInteraction) => buttonInteraction.user.id === interaction.user.id;
      const collector = interaction.channel.createMessageComponentCollector({ 
        filter, 
        time: 300000 // 5 minutes
      });

      collector.on('collect', async (buttonInteraction) => {
        try {
          await buttonInteraction.deferUpdate();

          switch (buttonInteraction.customId) {
            case 'refresh_status':
              // Réexécuter la commande status
              await this.execute(buttonInteraction, bot);
              break;

            case 'view_logs':
              await this.showLogs(buttonInteraction, bot);
              break;

            case 'manage_jobs':
              await this.showJobManager(buttonInteraction, bot);
              break;
          }
        } catch (error) {
          logger.error('Erreur lors de l\'interaction avec les boutons:', error);
        }
      });

      collector.on('end', () => {
        // Désactiver les boutons après expiration
        const disabledButtons = new ActionRowBuilder()
          .addComponents(
            buttons.components.map(button => 
              ButtonBuilder.from(button).setDisabled(true)
            )
          );

        interaction.editReply({ 
          embeds: [statusEmbed],
          components: [disabledButtons]
        }).catch(() => {
          // Ignorer les erreurs si le message n'existe plus
        });
      });

    } catch (error) {
      logger.error('Erreur dans la commande status:', error);
      
      const errorEmbed = new EmbedBuilder()
        .setColor('#FF0000')
        .setTitle('❌ Erreur système')
        .setDescription('Une erreur s\'est produite lors de la récupération du statut.')
        .setFooter({ text: 'Réessayez dans quelques instants' });

      if (interaction.replied || interaction.deferred) {
        await interaction.editReply({ embeds: [errorEmbed] });
      } else {
        await interaction.reply({ embeds: [errorEmbed], ephemeral: true });
      }
    }
  },

  async showLogs(interaction, bot) {
    try {
      const logs = await bot.database.all(`
        SELECT 
          rl.*, rj.item_url, rj.item_id
        FROM repost_logs rl
        LEFT JOIN repost_jobs rj ON rl.job_id = rj.id
        WHERE rl.discord_user_id = ?
        ORDER BY rl.created_at DESC
        LIMIT 10
      `, [interaction.user.id]);

      const logsEmbed = new EmbedBuilder()
        .setColor('#4A90E2')
        .setTitle('📋 Historique des reposts (10 derniers)')
        .setDescription(logs.length === 0 ? 'Aucun repost effectué récemment.' : 'Voici vos dernières activités de repost:');

      if (logs.length > 0) {
        const logsText = logs.map(log => {
          const status = log.success ? '✅' : '❌';
          const date = new Date(log.created_at).toLocaleString('fr-FR');
          const proxy = log.proxy_used ? ` (${log.proxy_used})` : '';
          const time = log.execution_time ? ` - ${log.execution_time}ms` : '';
          
          return `${status} **[${log.item_id}](${log.item_url || '#'})** - ${date}${proxy}${time}
          ${log.message ? `*${log.message}*` : ''}`;
        }).join('\n\n');

        logsEmbed.setDescription(logsText);
      }

      logsEmbed.setFooter({ text: 'Les logs sont conservés 30 jours • Vinted Elite Bot' });
      logsEmbed.setTimestamp();

      await interaction.editReply({ embeds: [logsEmbed], components: [] });
    } catch (error) {
      logger.error('Erreur lors de l\'affichage des logs:', error);
    }
  },

  async showJobManager(interaction, bot) {
    try {
      const jobs = await bot.database.all(
        'SELECT * FROM repost_jobs WHERE discord_user_id = ? ORDER BY created_at DESC',
        [interaction.user.id]
      );

      const managerEmbed = new EmbedBuilder()
        .setColor('#9B59B6')
        .setTitle('⚙️ Gestionnaire de jobs de repost')
        .setDescription(jobs.length === 0 ? 'Aucun job de repost configuré.' : `Vous avez ${jobs.length} job(s) configuré(s):`);

      if (jobs.length > 0) {
        const jobsText = jobs.map(job => {
          const status = job.is_active ? '🟢 Actif' : '🔴 Inactif';
          const progress = `${job.nombre_effectue}/${job.nombre_total}`;
          const nextRepost = new Date(job.prochain_repost);
          const isOverdue = nextRepost <= new Date();
          
          return `**${status}** [${job.item_id}](${job.item_url})
          📊 Progression: ${progress} | ⏰ Prochain: <t:${Math.floor(nextRepost.getTime() / 1000)}:R> ${isOverdue ? '(En retard)' : ''}
          🔄 Intervalle: ${job.intervalle}h | 📅 Créé: <t:${Math.floor(new Date(job.created_at).getTime() / 1000)}:d>`;
        }).join('\n\n');

        managerEmbed.setDescription(jobsText);
      }

      // Boutons de gestion
      const managementButtons = new ActionRowBuilder()
        .addComponents(
          new ButtonBuilder()
            .setCustomId('pause_all_jobs')
            .setLabel('⏸️ Tout suspendre')
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(jobs.filter(j => j.is_active).length === 0),
          new ButtonBuilder()
            .setCustomId('resume_all_jobs')
            .setLabel('▶️ Tout reprendre')
            .setStyle(ButtonStyle.Success)
            .setDisabled(jobs.filter(j => !j.is_active).length === 0),
          new ButtonBuilder()
            .setCustomId('cleanup_completed')
            .setLabel('🧹 Nettoyer terminés')
            .setStyle(ButtonStyle.Danger)
            .setDisabled(jobs.filter(j => j.nombre_effectue >= j.nombre_total).length === 0)
        );

      managerEmbed.setFooter({ text: 'Utilisez les boutons pour gérer vos jobs • Vinted Elite Bot' });
      managerEmbed.setTimestamp();

      await interaction.editReply({ 
        embeds: [managerEmbed], 
        components: [managementButtons] 
      });
    } catch (error) {
      logger.error('Erreur lors de l\'affichage du gestionnaire de jobs:', error);
    }
  }
};