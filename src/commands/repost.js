import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { logger } from '../index.js';

export default {
  data: new SlashCommandBuilder()
    .setName('repost')
    .setDescription('🔄 Reposter automatiquement une annonce Vinted pour améliorer sa visibilité')
    .addStringOption(option =>
      option.setName('lien')
        .setDescription('🔗 Lien de votre annonce Vinted à reposter')
        .setRequired(true))
    .addIntegerOption(option =>
      option.setName('intervalle')
        .setDescription('⏰ Intervalle entre les reposts en heures (1-24, défaut: 6)')
        .setMinValue(1)
        .setMaxValue(24)
        .setRequired(false))
    .addIntegerOption(option =>
      option.setName('nombre')
        .setDescription('🔢 Nombre total de reposts (1-10, défaut: 3)')
        .setMinValue(1)
        .setMaxValue(10)
        .setRequired(false))
    .addBooleanOption(option =>
      option.setName('immediatement')
        .setDescription('⚡ Effectuer le premier repost immédiatement (défaut: false)')
        .setRequired(false)),

  async execute(interaction, bot) {
    try {
      await interaction.deferReply({ ephemeral: true });

      // Vérifier si l'utilisateur est connecté
      const user = await bot.database.getUser(interaction.user.id);
      if (!user || !user.isActive) {
        const errorEmbed = new EmbedBuilder()
          .setColor('#FF0000')
          .setTitle('🔒 Compte non connecté')
          .setDescription('Vous devez d\'abord connecter votre compte Vinted avec `/login`')
          .addFields(
            { name: '🔧 Solution', value: 'Utilisez la commande `/login` pour connecter votre compte' }
          )
          .setFooter({ text: 'Vinted Elite Bot - Connexion requise' });

        await interaction.editReply({ embeds: [errorEmbed] });
        return;
      }

      // Récupérer les paramètres
      const lienAnnonce = interaction.options.getString('lien');
      const intervalle = interaction.options.getInteger('intervalle') || 6;
      const nombreReposts = interaction.options.getInteger('nombre') || 3;
      const immediatement = interaction.options.getBoolean('immediatement') || false;

      // Valider le lien Vinted
      const vintedUrlPattern = /^https:\/\/www\.vinted\.(fr|be|de|es|it|nl|pl|cz|lt|lv|lu|at)\/items\/(\d+)/;
      const urlMatch = lienAnnonce.match(vintedUrlPattern);
      
      if (!urlMatch) {
        const errorEmbed = new EmbedBuilder()
          .setColor('#FF0000')
          .setTitle('❌ Lien invalide')
          .setDescription('Le lien fourni n\'est pas un lien Vinted valide.')
          .addFields(
            { name: '✅ Format attendu', value: 'https://www.vinted.fr/items/123456789' },
            { name: '🔍 Exemple', value: lienAnnonce.substring(0, 50) + '...' }
          )
          .setFooter({ text: 'Assurez-vous de copier le lien complet de votre annonce' });

        await interaction.editReply({ embeds: [errorEmbed] });
        return;
      }

      const itemId = urlMatch[2];
      const country = urlMatch[1];

      // Vérifier que le pays correspond à celui du compte
      if (country !== user.country) {
        const warningEmbed = new EmbedBuilder()
          .setColor('#FFA500')
          .setTitle('⚠️ Pays différent détecté')
          .setDescription(`L'annonce est sur Vinted ${country.toUpperCase()} mais votre compte est configuré pour ${user.country.toUpperCase()}`)
          .addFields(
            { name: '🔧 Solution', value: 'Reconnectez-vous avec `/login` en utilisant le bon pays, ou utilisez une annonce du bon domaine Vinted.' }
          );

        await interaction.editReply({ embeds: [warningEmbed] });
        return;
      }

      // Créer l'embed de confirmation
      const confirmEmbed = new EmbedBuilder()
        .setColor('#FFD700')
        .setTitle('🔄 Repost programmé')
        .setDescription('Votre annonce va être repostée automatiquement selon les paramètres choisis.')
        .addFields(
          { name: '🔗 Annonce', value: `[Voir l'annonce](${lienAnnonce})`, inline: true },
          { name: '🆔 ID Article', value: itemId, inline: true },
          { name: '🌍 Pays', value: country.toUpperCase(), inline: true },
          { name: '⏰ Intervalle', value: `${intervalle}h`, inline: true },
          { name: '🔢 Nombre total', value: `${nombreReposts} reposts`, inline: true },
          { name: '⚡ Démarrage', value: immediatement ? '🟢 Immédiat' : '🟡 Différé', inline: true }
        )
        .setFooter({ text: 'Repost intelligent avec rotation de proxy et anti-détection' })
        .setTimestamp();

      await interaction.editReply({ embeds: [confirmEmbed] });

      // Programmer les reposts
      const repostJob = {
        discordUserId: interaction.user.id,
        itemId: itemId,
        itemUrl: lienAnnonce,
        country: country,
        intervalle: intervalle,
        nombreTotal: nombreReposts,
        nombreEffectue: 0,
        prochainRepost: immediatement ? new Date() : new Date(Date.now() + intervalle * 60 * 60 * 1000),
        isActive: true,
        createdAt: new Date()
      };

      // Sauvegarder le job de repost
      await bot.database.saveRepostJob(repostJob);

      // Si repost immédiat demandé
      if (immediatement) {
        setTimeout(async () => {
          try {
            const result = await bot.vinted.repostItem(user, itemId, lienAnnonce);
            
            const resultEmbed = new EmbedBuilder()
              .setColor(result.success ? '#00FF00' : '#FF0000')
              .setTitle(result.success ? '✅ Premier repost effectué' : '❌ Erreur de repost')
              .setDescription(result.message)
              .addFields(
                { name: '🕐 Heure', value: `<t:${Math.floor(Date.now() / 1000)}:F>`, inline: true },
                { name: '🔄 Prochain repost', value: `<t:${Math.floor((Date.now() + intervalle * 60 * 60 * 1000) / 1000)}:R>`, inline: true }
              )
              .setFooter({ text: `Repost 1/${nombreReposts} • Proxy: ${result.proxyUsed || 'Auto'}` });

            await interaction.followUp({ embeds: [resultEmbed], ephemeral: true });

            // Mettre à jour le compteur
            if (result.success) {
              await bot.database.updateRepostJob(itemId, { nombreEffectue: 1 });
            }

          } catch (error) {
            logger.error('Erreur lors du repost immédiat:', error);
          }
        }, Math.random() * 5000 + 2000); // Délai aléatoire entre 2-7 secondes
      }

      // Programmer les reposts suivants
      await bot.vinted.scheduleReposts(repostJob);

      // Embed final avec récapitulatif
      const finalEmbed = new EmbedBuilder()
        .setColor('#00FF00')
        .setTitle('✅ Automation configurée')
        .setDescription('Votre annonce sera repostée automatiquement selon le planning défini.')
        .addFields(
          { name: '📊 Statut', value: '🟢 Actif', inline: true },
          { name: '🎯 Objectif', value: `${nombreReposts} reposts`, inline: true },
          { name: '🔐 Sécurité', value: '🛡️ Anti-détection activé', inline: true },
          { name: '🌐 Proxies', value: '🔄 Rotation automatique', inline: true },
          { name: '⏱️ Délais', value: '🎲 Randomisés', inline: true },
          { name: '📱 User Agent', value: '🔄 Rotation activée', inline: true }
        )
        .setFooter({ text: 'Vous recevrez une notification à chaque repost • Type /status pour voir l\'état' })
        .setTimestamp();

      await interaction.followUp({ embeds: [finalEmbed], ephemeral: true });

      logger.info(`Repost programmé pour ${interaction.user.tag} - Article ${itemId} - ${nombreReposts} reposts toutes les ${intervalle}h`);

    } catch (error) {
      logger.error('Erreur dans la commande repost:', error);
      
      const errorEmbed = new EmbedBuilder()
        .setColor('#FF0000')
        .setTitle('❌ Erreur système')
        .setDescription('Une erreur inattendue s\'est produite lors de la programmation du repost.')
        .addFields(
          { name: '🔧 Solutions', value: '• Vérifiez votre connexion Internet\n• Réessayez dans quelques minutes\n• Contactez un administrateur si le problème persiste' },
          { name: '📝 Détails de l\'erreur', value: `\`\`\`${error.message.substring(0, 100)}...\`\`\`` }
        )
        .setFooter({ text: 'Support technique disponible 24/7' });

      if (interaction.replied || interaction.deferred) {
        await interaction.editReply({ embeds: [errorEmbed] });
      } else {
        await interaction.reply({ embeds: [errorEmbed], ephemeral: true });
      }
    }
  }
};