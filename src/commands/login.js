import { SlashCommandBuilder, EmbedBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder } from 'discord.js';
import { logger } from '../index.js';

export default {
  data: new SlashCommandBuilder()
    .setName('login')
    .setDescription('🔐 Connectez votre compte Vinted au bot pour utiliser l\'automation')
    .setDefaultMemberPermissions('0'),

  async execute(interaction, bot) {
    try {
      // Vérifier si l'utilisateur a déjà un compte connecté
      const existingUser = await bot.database.getUser(interaction.user.id);
      
      if (existingUser && existingUser.isActive) {
        const embed = new EmbedBuilder()
          .setColor('#FF6B35')
          .setTitle('🔗 Compte déjà connecté')
          .setDescription('Votre compte Vinted est déjà connecté et actif.')
          .addFields(
            { name: '📧 Email', value: `||${existingUser.email}||`, inline: true },
            { name: '🕐 Connecté le', value: `<t:${Math.floor(existingUser.createdAt / 1000)}:F>`, inline: true },
            { name: '📊 Statut', value: '✅ Actif', inline: true }
          )
          .setFooter({ text: 'Vinted Elite Bot • Sécurisé par chiffrement AES-256' })
          .setTimestamp();

        await interaction.reply({ embeds: [embed], ephemeral: true });
        return;
      }

      // Créer le modal pour les informations de connexion
      const modal = new ModalBuilder()
        .setCustomId('vinted_login_modal')
        .setTitle('🔐 Connexion Vinted Elite');

      const emailInput = new TextInputBuilder()
        .setCustomId('email')
        .setLabel('📧 Adresse email Vinted')
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('votre-email@exemple.com')
        .setRequired(true)
        .setMaxLength(100);

      const passwordInput = new TextInputBuilder()
        .setCustomId('password')
        .setLabel('🔒 Mot de passe Vinted')
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('Votre mot de passe sécurisé')
        .setRequired(true)
        .setMaxLength(100);

      const countryInput = new TextInputBuilder()
        .setCustomId('country')
        .setLabel('🌍 Pays Vinted (fr, be, de, etc.)')
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('fr')
        .setRequired(true)
        .setMaxLength(5)
        .setMinLength(2);

      const userAgentInput = new TextInputBuilder()
        .setCustomId('user_agent')
        .setLabel('🌐 User Agent (optionnel - laissez vide pour auto)')
        .setStyle(TextInputStyle.Paragraph)
        .setPlaceholder('Mozilla/5.0 (Windows NT 10.0; Win64; x64)...')
        .setRequired(false)
        .setMaxLength(500);

      const proxyInput = new TextInputBuilder()
        .setCustomId('proxy')
        .setLabel('🔗 Proxy personnel (optionnel - format: ip:port:user:pass)')
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('192.168.1.1:8080:username:password')
        .setRequired(false)
        .setMaxLength(200);

      const firstActionRow = new ActionRowBuilder().addComponents(emailInput);
      const secondActionRow = new ActionRowBuilder().addComponents(passwordInput);
      const thirdActionRow = new ActionRowBuilder().addComponents(countryInput);
      const fourthActionRow = new ActionRowBuilder().addComponents(userAgentInput);
      const fifthActionRow = new ActionRowBuilder().addComponents(proxyInput);

      modal.addComponents(firstActionRow, secondActionRow, thirdActionRow, fourthActionRow, fifthActionRow);

      await interaction.showModal(modal);

      // Gestionnaire de soumission du modal
      const filter = (modalInteraction) => modalInteraction.customId === 'vinted_login_modal';
      
      try {
        const modalSubmission = await interaction.awaitModalSubmit({ filter, time: 300000 }); // 5 minutes timeout
        
        await modalSubmission.deferReply({ ephemeral: true });

        const email = modalSubmission.fields.getTextInputValue('email');
        const password = modalSubmission.fields.getTextInputValue('password');
        const country = modalSubmission.fields.getTextInputValue('country').toLowerCase();
        const customUserAgent = modalSubmission.fields.getTextInputValue('user_agent') || null;
        const customProxy = modalSubmission.fields.getTextInputValue('proxy') || null;

        // Validation des données
        if (!email.includes('@') || !email.includes('.')) {
          throw new Error('Format d\'email invalide');
        }

        if (password.length < 6) {
          throw new Error('Le mot de passe doit contenir au moins 6 caractères');
        }

        const validCountries = ['fr', 'be', 'de', 'es', 'it', 'nl', 'pl', 'cz', 'lt', 'lv', 'lu', 'at'];
        if (!validCountries.includes(country)) {
          throw new Error(`Pays non supporté. Pays disponibles: ${validCountries.join(', ')}`);
        }

        // Créer un embed de progression
        const progressEmbed = new EmbedBuilder()
          .setColor('#FFD700')
          .setTitle('🔄 Connexion en cours...')
          .setDescription('Validation et chiffrement des informations...')
          .addFields(
            { name: '📧 Email', value: `||${email}||`, inline: true },
            { name: '🌍 Pays', value: country.toUpperCase(), inline: true },
            { name: '🔐 Statut', value: '🔄 Vérification...', inline: true }
          )
          .setFooter({ text: 'Cette opération peut prendre jusqu\'à 30 secondes' })
          .setTimestamp();

        await modalSubmission.editReply({ embeds: [progressEmbed] });

        // Tenter la connexion avec Vinted
        const loginResult = await bot.vinted.authenticateUser({
          email,
          password,
          country,
          userAgent: customUserAgent,
          proxy: customProxy
        });

        if (loginResult.success) {
          // Sauvegarder les informations dans la base de données (chiffrées)
          await bot.database.saveUser({
            discordId: interaction.user.id,
            email: email,
            password: password, // Sera chiffré dans la base
            country: country,
            userAgent: loginResult.userAgent,
            proxy: customProxy,
            vintedUserId: loginResult.vintedUserId,
            cookies: loginResult.cookies,
            isActive: true
          });

          const successEmbed = new EmbedBuilder()
            .setColor('#00FF00')
            .setTitle('✅ Connexion réussie!')
            .setDescription('Votre compte Vinted a été connecté avec succès au bot.')
            .addFields(
              { name: '👤 Utilisateur Vinted', value: `ID: ${loginResult.vintedUserId}`, inline: true },
              { name: '📧 Email', value: `||${email}||`, inline: true },
              { name: '🌍 Pays', value: country.toUpperCase(), inline: true },
              { name: '🔒 Sécurité', value: '🛡️ Données chiffrées AES-256', inline: true },
              { name: '🔗 Proxy', value: customProxy ? '✅ Configuré' : '🔄 Auto-rotatif', inline: true },
              { name: '📱 User Agent', value: loginResult.userAgent ? '✅ Configuré' : '🔄 Automatique', inline: true }
            )
            .setFooter({ text: 'Vous pouvez maintenant utiliser /repost pour automatiser vos annonces' })
            .setTimestamp();

          await modalSubmission.editReply({ embeds: [successEmbed] });

          logger.info(`Utilisateur ${interaction.user.tag} connecté avec succès à Vinted`);

        } else {
          throw new Error(loginResult.error || 'Échec de la connexion Vinted');
        }

      } catch (modalError) {
        if (modalError.code === 'InteractionCollectorError') {
          // Timeout du modal
          const timeoutEmbed = new EmbedBuilder()
            .setColor('#FF0000')
            .setTitle('⏰ Temps écoulé')
            .setDescription('Le formulaire de connexion a expiré. Veuillez relancer la commande `/login`.')
            .setFooter({ text: 'Délai d\'attente: 5 minutes' });

          await interaction.followUp({ embeds: [timeoutEmbed], ephemeral: true });
          return;
        }

        // Autres erreurs
        const errorEmbed = new EmbedBuilder()
          .setColor('#FF0000')
          .setTitle('❌ Erreur de connexion')
          .setDescription(`**Erreur:** ${modalError.message}`)
          .addFields(
            { name: '🔍 Solutions possibles', value: '• Vérifiez vos identifiants Vinted\n• Assurez-vous que votre compte n\'est pas bloqué\n• Vérifiez le format du proxy (si utilisé)\n• Contactez un administrateur si le problème persiste' }
          )
          .setFooter({ text: 'Support technique disponible 24/7' })
          .setTimestamp();

        if (modalSubmission) {
          await modalSubmission.editReply({ embeds: [errorEmbed] });
        } else {
          await interaction.followUp({ embeds: [errorEmbed], ephemeral: true });
        }

        logger.error(`Erreur de connexion pour ${interaction.user.tag}:`, modalError);
      }

    } catch (error) {
      logger.error('Erreur dans la commande login:', error);
      
      const embed = new EmbedBuilder()
        .setColor('#FF0000')
        .setTitle('❌ Erreur système')
        .setDescription('Une erreur inattendue s\'est produite. Veuillez réessayer.')
        .setFooter({ text: 'Si le problème persiste, contactez un administrateur' });

      if (interaction.replied || interaction.deferred) {
        await interaction.followUp({ embeds: [embed], ephemeral: true });
      } else {
        await interaction.reply({ embeds: [embed], ephemeral: true });
      }
    }
  }
};