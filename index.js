require('dotenv').config();
const { Client, GatewayIntentBits, REST, Routes, 
  SlashCommandBuilder, ActionRowBuilder, StringSelectMenuBuilder, ComponentType,
  EmbedBuilder, ButtonBuilder, ButtonStyle, ActivityType
} = require('discord.js');
const { joinVoiceChannel, createAudioPlayer, createAudioResource, AudioPlayerStatus } = require('@discordjs/voice');
const ytdl = require('@distube/ytdl-core');
const ytSearch = require('yt-search');
const ytpl = require('@distube/ytpl');

// NEW: Spotify API integration
const SpotifyWebApi = require('spotify-web-api-node');

const BOT_TOKEN = process.env.BOT_TOKEN;
const BOT_OWNER_ID = process.env.BOT_OWNER_ID;
const DJ_ROLE_ID = process.env.DJ_ROLE_ID;

// Initialize Spotify client
const spotifyApi = new SpotifyWebApi({
  clientId: process.env.SPOTIFY_CLIENT_ID,
  clientSecret: process.env.SPOTIFY_CLIENT_SECRET,
});

// Function to refresh Spotify access token using Client Credentials Flow
async function refreshSpotifyToken() {
  try {
    const data = await spotifyApi.clientCredentialsGrant();
    spotifyApi.setAccessToken(data.body['access_token']);
    console.log('Spotify token refreshed');
    // Refresh token a minute before expiration
    setTimeout(refreshSpotifyToken, (data.body['expires_in'] - 60) * 1000);
  } catch (err) {
    console.error('Failed to refresh Spotify token', err);
  }
}
refreshSpotifyToken();

// Helper: Extract Spotify ID from URL for a given type (track, playlist, album)
function getSpotifyId(url, type) {
  const regex = new RegExp(`/${type}/([a-zA-Z0-9]+)`);
  const match = url.match(regex);
  return match ? match[1] : null;
}

// Helper: Given a Spotify track object, search YouTube for a matching video.
async function searchYouTubeFromSpotifyTrack(track, requester) {
  const searchQuery = `${track.name} ${track.artists.map(artist => artist.name).join(' ')}`;
  const result = await ytSearch(searchQuery);
  if (!result.videos.length) return null;
  const video = result.videos[0];
  return {
    title: video.title,
    url: video.url, // This URL is used for playback.
    duration: video.seconds || 0,
    requester: requester,
  };
}

// Helper: Format a duration in seconds to mm:ss
function formatDuration(seconds) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent, GatewayIntentBits.GuildVoiceStates],
});

// A map to store queues per guild
const queueMap = new Map();

// Helper: Check if a member is a DJ or bot owner
function isDJ(interaction) {
  return interaction.user.id === BOT_OWNER_ID ||
         (DJ_ROLE_ID && interaction.member.roles.cache.has(DJ_ROLE_ID));
}

// Function to play a song from the queue and auto-disconnect if idle for 1 minute or if no user is in VC
function playSong(guildId, song) {
  const queue = queueMap.get(guildId);
  if (!song) {
    if (!queue.idleTimer) {
      queue.idleTimer = setTimeout(() => {
        if (queue.voiceChannel.members.filter(m => !m.user.bot).size === 0) {
          console.log("Disconnecting: no users left in the voice channel.");
        } else {
          console.log("Disconnecting: idle for 1 minute.");
        }
        queue.connection.destroy();
        queueMap.delete(guildId);
      }, 60000);
    }
    return;
  }
  if (queue.idleTimer) {
    clearTimeout(queue.idleTimer);
    queue.idleTimer = null;
  }
  const stream = ytdl(song.url, {
    filter: 'audioonly',
    quality: 'highestaudio',
    highWaterMark: 1 << 25,
  });
  const resource = createAudioResource(stream, { inlineVolume: true });
  resource.volume.setVolume(queue.volume);
  queue.resource = resource;
  queue.nowPlayingStart = Date.now();
  queue.player.play(resource);

  queue.player.once(AudioPlayerStatus.Idle, () => {
    if (queue.voiceChannel.members.filter(m => !m.user.bot).size === 0) {
      queue.connection.destroy();
      queueMap.delete(guildId);
      return;
    }
    if (queue.loop) {
      playSong(guildId, song);
    } else {
      queue.songs.shift();
      queue.votes = [];
      playSong(guildId, queue.songs[0]);
    }
  });

  queue.player.on('error', error => {
    console.error(`Error: ${error.message}`);
    queue.songs.shift();
    playSong(guildId, queue.songs[0]);
  });
}

// Define all slash commands
const commands = [
  new SlashCommandBuilder()
    .setName('play')
    .setDescription('Play a YouTube video, playlist, Spotify track, playlist, album, or search term.')
    .addStringOption(option =>
      option.setName('query').setDescription('YouTube URL, Spotify URL, or search term').setRequired(true)
    ),
  new SlashCommandBuilder()
    .setName('search')
    .setDescription('Search YouTube and choose a video interactively.')
    .addStringOption(option =>
      option.setName('query').setDescription('Search term').setRequired(true)
    ),
  new SlashCommandBuilder()
    .setName('voteskip')
    .setDescription('Vote to skip the current song.'),
  new SlashCommandBuilder()
    .setName('remove')
    .setDescription('Remove a song from the queue by its position (not the currently playing one).')
    .addIntegerOption(option =>
      option.setName('index').setDescription('Position in queue (starting at 2)').setRequired(true)
    ),
  new SlashCommandBuilder()
    .setName('move')
    .setDescription('Move a song in the queue from one position to another.')
    .addIntegerOption(option =>
      option.setName('from').setDescription('Current position (starting at 2)').setRequired(true)
    )
    .addIntegerOption(option =>
      option.setName('to').setDescription('New position').setRequired(true)
    ),
  new SlashCommandBuilder()
    .setName('jump')
    .setDescription('Jump to a specific song in the queue (skipping intermediate songs).')
    .addIntegerOption(option =>
      option.setName('index').setDescription('Position in queue (starting at 2)').setRequired(true)
    ),
  new SlashCommandBuilder()
    .setName('skip')
    .setDescription('Immediately skip the current song (DJ or requester only).'),
  new SlashCommandBuilder()
    .setName('stop')
    .setDescription('Stop playback, clear the queue, and disconnect.'),
  new SlashCommandBuilder()
    .setName('pause')
    .setDescription('Pause playback.'),
  new SlashCommandBuilder()
    .setName('resume')
    .setDescription('Resume playback.'),
  new SlashCommandBuilder()
    .setName('queue')
    .setDescription('Display the current song queue.'),
  new SlashCommandBuilder()
    .setName('np')
    .setDescription('Display the currently playing song with details.'),
  new SlashCommandBuilder()
    .setName('volume')
    .setDescription('Set playback volume (0.0 to 5.0).')
    .addNumberOption(option =>
      option.setName('level').setDescription('Volume level (0.0 to 5.0)').setRequired(true)
    ),
  new SlashCommandBuilder()
    .setName('loop')
    .setDescription('Toggle looping of the current song.'),
  new SlashCommandBuilder()
    .setName('shuffle')
    .setDescription('Shuffle the queue (except the current song).'),
  new SlashCommandBuilder()
    .setName('clear')
    .setDescription('Clear the queue (except the currently playing song).'),
  new SlashCommandBuilder()
    .setName('refreshcommands')
    .setDescription('Remove all global commands (Bot Owner only).'),
  new SlashCommandBuilder()
    .setName('help')
    .setDescription('Show help for available commands.'),
].map(command => command.toJSON());

// Register commands (global)
client.once('ready', async () => {
  console.log(`Logged in as ${client.user.tag}!`);
  client.user.setActivity("Stuff", { 
    type: ActivityType.Streaming, 
    url: "https://www.twitch.tv/emiru/" 
  });
  const rest = new REST({ version: '10' }).setToken(BOT_TOKEN);
  try {
    console.log('Started refreshing global application (/) commands.');
    await rest.put(Routes.applicationCommands(client.user.id), { body: commands });
    console.log('Successfully reloaded global application (/) commands.');
  } catch (error) {
    console.error(error);
  }
});

// Interaction handler
client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;
  const guildId = interaction.guildId;
  let queue = queueMap.get(guildId);

  switch (interaction.commandName) {

    // /play command supports video/playlist URLs as well as Spotify links
    case 'play': {
      if (!interaction.guild) {
        return interaction.reply({ content: "This command can only be used in a server."});
      }      
      const member = interaction.member;
      const voiceChannel = member.voice?.channel;
      if (!voiceChannel) {
        return interaction.reply({ content: 'You must join a voice channel first!', ephemeral: true });
      }
      // Defer reply to avoid timeout
      await interaction.deferReply();

      const query = interaction.options.getString('query');

      // Handle Spotify URLs
      if (query.includes('open.spotify.com')) {
        // Spotify Track
        if (query.includes('/track/')) {
          const trackId = getSpotifyId(query, 'track');
          try {
            const data = await spotifyApi.getTrack(trackId);
            const trackInfo = data.body;
            let song = await searchYouTubeFromSpotifyTrack(trackInfo, interaction.user.id);
            if (!song) return interaction.editReply({ content: 'Could not find a matching YouTube video for this track.' });
            // Set source details for Spotify
            song.source = 'spotify';
            song.sourceUrl = trackInfo.external_urls.spotify || query;
            if (!queue) {
              const connection = joinVoiceChannel({
                channelId: voiceChannel.id,
                guildId: voiceChannel.guild.id,
                adapterCreator: voiceChannel.guild.voiceAdapterCreator,
              });
              const player = createAudioPlayer();
              connection.subscribe(player);
              queue = {
                voiceChannel,
                connection,
                player,
                songs: [],
                volume: 1.0,
                loop: false,
                votes: [],
                idleTimer: null
              };
              queueMap.set(guildId, queue);
            }
            if (queue.idleTimer) {
              clearTimeout(queue.idleTimer);
              queue.idleTimer = null;
            }
            queue.songs.push(song);
            if (queue.songs.length === 1) {
              playSong(guildId, song);
              return interaction.editReply(`Now playing: **${song.title}** (Spotify track)`);
            } else {
              return interaction.editReply(`Added to queue: **${song.title}** (Spotify track)`);
            }
          } catch (error) {
            console.error(error);
            return interaction.editReply({ content: 'Error fetching Spotify track details.', ephemeral: true });
          }
        }
        // Spotify Playlist
        else if (query.includes('/playlist/')) {
          const playlistId = getSpotifyId(query, 'playlist');
          try {
            const data = await spotifyApi.getPlaylist(playlistId);
            const playlistInfo = data.body;
            const tracks = playlistInfo.tracks.items.filter(item => item.track);
            const songs = [];
            for (const item of tracks) {
              const trackInfo = item.track;
              let song = await searchYouTubeFromSpotifyTrack(trackInfo, interaction.user.id);
              if (song) {
                song.source = 'spotify';
                song.sourceUrl = trackInfo.external_urls.spotify || query;
                songs.push(song);
              }
            }
            if (songs.length === 0) {
              return interaction.editReply({ content: 'No playable tracks found in this Spotify playlist.' });
            }
            if (!queue) {
              const connection = joinVoiceChannel({
                channelId: voiceChannel.id,
                guildId: voiceChannel.guild.id,
                adapterCreator: voiceChannel.guild.voiceAdapterCreator,
              });
              const player = createAudioPlayer();
              connection.subscribe(player);
              queue = {
                voiceChannel,
                connection,
                player,
                songs: [],
                volume: 1.0,
                loop: false,
                votes: [],
                idleTimer: null
              };
              queueMap.set(guildId, queue);
            }
            if (queue.idleTimer) {
              clearTimeout(queue.idleTimer);
              queue.idleTimer = null;
            }
            queue.songs.push(...songs);
            if (queue.songs.length === songs.length) {
              playSong(guildId, queue.songs[0]);
              return interaction.editReply(`Now playing Spotify playlist: **${playlistInfo.name}** with ${songs.length} tracks.`);
            } else {
              return interaction.editReply(`Added Spotify playlist: **${playlistInfo.name}** (${songs.length} tracks) to the queue.`);
            }
          } catch (error) {
            console.error(error);
            return interaction.editReply({ content: 'Error fetching Spotify playlist details.', ephemeral: true });
          }
        }
        // Spotify Album
        else if (query.includes('/album/')) {
          const albumId = getSpotifyId(query, 'album');
          try {
            const data = await spotifyApi.getAlbum(albumId);
            const albumInfo = data.body;
            const tracks = albumInfo.tracks.items;
            const songs = [];
            for (const trackInfo of tracks) {
              let song = await searchYouTubeFromSpotifyTrack(trackInfo, interaction.user.id);
              if (song) {
                song.source = 'spotify';
                song.sourceUrl = trackInfo.external_urls.spotify || query;
                songs.push(song);
              }
            }
            if (songs.length === 0) {
              return interaction.editReply({ content: 'No playable tracks found in this Spotify album.' });
            }
            if (!queue) {
              const connection = joinVoiceChannel({
                channelId: voiceChannel.id,
                guildId: voiceChannel.guild.id,
                adapterCreator: voiceChannel.guild.voiceAdapterCreator,
              });
              const player = createAudioPlayer();
              connection.subscribe(player);
              queue = {
                voiceChannel,
                connection,
                player,
                songs: [],
                volume: 1.0,
                loop: false,
                votes: [],
                idleTimer: null
              };
              queueMap.set(guildId, queue);
            }
            if (queue.idleTimer) {
              clearTimeout(queue.idleTimer);
              queue.idleTimer = null;
            }
            queue.songs.push(...songs);
            if (queue.songs.length === songs.length) {
              playSong(guildId, queue.songs[0]);
              return interaction.editReply(`Now playing Spotify album: **${albumInfo.name}** with ${songs.length} tracks.`);
            } else {
              return interaction.editReply(`Added Spotify album: **${albumInfo.name}** (${songs.length} tracks) to the queue.`);
            }
          } catch (error) {
            console.error(error);
            return interaction.editReply({ content: 'Error fetching Spotify album details.', ephemeral: true });
          }
        } else {
          return interaction.editReply({ content: 'Unsupported Spotify URL type.' });
        }
      }
      // End Spotify integration

      // Check if the query is a YouTube playlist URL
      if (ytpl.validateID(query)) {
        try {
          const playlist = await ytpl(query, { limit: 50 });
          const songs = playlist.items.map(item => ({
            title: item.title,
            url: item.shortUrl,
            duration: parseInt(item.durationSec) || 0,
            requester: interaction.user.id,
            source: 'youtube',
            sourceUrl: item.shortUrl
          }));
          if (!queue) {
            const connection = joinVoiceChannel({
              channelId: voiceChannel.id,
              guildId: voiceChannel.guild.id,
              adapterCreator: voiceChannel.guild.voiceAdapterCreator,
            });
            const player = createAudioPlayer();
            connection.subscribe(player);
            queue = {
              voiceChannel,
              connection,
              player,
              songs: [],
              volume: 1.0,
              loop: false,
              votes: [],
              idleTimer: null
            };
            queueMap.set(guildId, queue);
          }
          if (queue.idleTimer) {
            clearTimeout(queue.idleTimer);
            queue.idleTimer = null;
          }
          queue.songs.push(...songs);
          if (queue.songs.length === songs.length) {
            playSong(guildId, queue.songs[0]);
            return interaction.editReply(`Now playing playlist: **${playlist.title}** with ${songs.length} songs.`);
          } else {
            return interaction.editReply(`Added playlist: **${playlist.title}** (${songs.length} songs) to the queue.`);
          }
        } catch (error) {
          console.error(error);
          return interaction.editReply({ content: 'Error fetching playlist details.', ephemeral: true });
        }
      } else {
        // If not a playlist, treat it as a video URL or search term
        let song = null;
        if (ytdl.validateURL(query)) {
          try {
            const songInfo = await ytdl.getInfo(query);
            song = {
              title: songInfo.videoDetails.title,
              url: songInfo.videoDetails.video_url,
              duration: parseInt(songInfo.videoDetails.lengthSeconds) || 0,
              requester: interaction.user.id,
              source: 'youtube',
              sourceUrl: songInfo.videoDetails.video_url
            };
          } catch (error) {
            console.error(error);
            return interaction.editReply({ content: 'Error fetching video details.', ephemeral: true });
          }
        } else {
          const searchResult = await ytSearch(query);
          if (!searchResult.videos.length) {
            return interaction.editReply({ content: 'No video results found.' });
          }
          const video = searchResult.videos[0];
          song = {
            title: video.title,
            url: video.url,
            duration: video.seconds || 0,
            requester: interaction.user.id,
            source: 'youtube',
            sourceUrl: video.url
          };
        }
        if (!queue) {
          const connection = joinVoiceChannel({
            channelId: voiceChannel.id,
            guildId: voiceChannel.guild.id,
            adapterCreator: voiceChannel.guild.voiceAdapterCreator,
          });
          const player = createAudioPlayer();
          connection.subscribe(player);
          queue = {
            voiceChannel,
            connection,
            player,
            songs: [],
            volume: 1.0,
            loop: false,
            votes: [],
            idleTimer: null
          };
          queueMap.set(guildId, queue);
        }
        if (queue.idleTimer) {
          clearTimeout(queue.idleTimer);
          queue.idleTimer = null;
        }
        queue.songs.push(song);
        if (queue.songs.length === 1) {
          playSong(guildId, song);
          return interaction.editReply(`Now playing: **${song.title}**`);
        } else {
          return interaction.editReply(`Added to queue: **${song.title}**`);
        }
      }
    }

    // /search command with interactive select menu
    case 'search': {
      if (!interaction.guild) {
        return interaction.reply({ content: "This command can only be used in a server."});
      }    
      const member = interaction.member;
      const voiceChannel = member.voice?.channel;
      if (!voiceChannel) {
        return interaction.reply({ content: 'You must join a voice channel first!', ephemeral: true });
      }
      // Defer reply for the interactive selection
      await interaction.deferReply();

      const query = interaction.options.getString('query');
      const results = await ytSearch(query);
      if (!results.videos.length) {
        return interaction.editReply({ content: 'No results found.' });
      }
      const topResults = results.videos.slice(0, 5);
      const options = topResults.map((video, index) => ({
        label: video.title.substring(0, 100),
        description: video.author.name,
        value: index.toString(),
      }));
      const row = new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId('search_select')
          .setPlaceholder('Select a video')
          .addOptions(options)
      );
      // Edit the deferred reply to include the select menu
      await interaction.editReply({ content: 'Select a video from the list below:', components: [row] });
      
      const message = await interaction.fetchReply();
      const collector = message.createMessageComponentCollector({
        componentType: ComponentType.StringSelect,
        time: 15000,
      });
      
      collector.on('collect', async i => {
        if (i.user.id !== interaction.user.id) {
          return i.reply({ content: 'This is not your selection!', ephemeral: true });
        }
        const selected = topResults[parseInt(i.values[0])];
        const song = {
          title: selected.title,
          url: selected.url,
          duration: selected.seconds || 0,
          requester: interaction.user.id,
          source: 'youtube',
          sourceUrl: selected.url
        };
        if (!queue) {
          const connection = joinVoiceChannel({
            channelId: voiceChannel.id,
            guildId: voiceChannel.guild.id,
            adapterCreator: voiceChannel.guild.voiceAdapterCreator,
          });
          const player = createAudioPlayer();
          connection.subscribe(player);
          queue = {
            voiceChannel,
            connection,
            player,
            songs: [],
            volume: 1.0,
            loop: false,
            votes: [],
            idleTimer: null
          };
          queueMap.set(interaction.guildId, queue);
        }
        if (queue.idleTimer) {
          clearTimeout(queue.idleTimer);
          queue.idleTimer = null;
        }
        queue.songs.push(song);
        if (queue.songs.length === 1) {
          playSong(interaction.guildId, song);
          await i.update({ content: `Now playing: **${song.title}**`, components: [] });
        } else {
          await i.update({ content: `Added to queue: **${song.title}**`, components: [] });
        }
      });
      
      collector.on('end', async collected => {
        if (collected.size === 0) {
          await interaction.editReply({ content: 'No selection made, please try again.', components: [] });
        }
      });
      break;
    }

    // /voteskip command for democratic skip
    case 'voteskip': {
      if (!interaction.guild) {
        return interaction.reply({ content: "This command can only be used in a server."});
      }    
      if (!queue || queue.songs.length === 0) {
        return interaction.reply({ content: 'There is no song playing.' });
      }
      if (queue.songs[0].requester === interaction.user.id || isDJ(interaction)) {
        queue.player.stop();
        return interaction.reply('Song skipped.');
      }
      if (!queue.votes) queue.votes = [];
      if (queue.votes.includes(interaction.user.id)) {
        return interaction.reply({ content: 'You have already voted to skip this song.' });
      }
      queue.votes.push(interaction.user.id);
      const voiceCount = queue.voiceChannel.members.filter(m => !m.user.bot).size;
      const threshold = Math.ceil(voiceCount / 2);
      if (queue.votes.length >= threshold) {
        queue.player.stop();
        return interaction.reply(`Vote threshold reached (${queue.votes.length}/${threshold}). Skipping song.`);
      } else {
        return interaction.reply(`Your vote has been registered. (${queue.votes.length}/${threshold} votes)`);
      }
    }

    // /remove command: remove a song from the queue (not the current one)
    case 'remove': {
      if (!interaction.guild) {
        return interaction.reply({ content: "This command can only be used in a server."});
      }    
      if (!queue || queue.songs.length < 2) {
        return interaction.reply({ content: 'No songs available to remove.' });
      }
      const index = interaction.options.getInteger('index');
      if (index < 2 || index > queue.songs.length) {
        return interaction.reply({ content: 'Invalid index.' });
      }
      const removed = queue.songs.splice(index - 1, 1)[0];
      return interaction.reply(`Removed **${removed.title}** from the queue.`);
    }

    // /move command: move a song from one position to another in the queue
    case 'move': {
      if (!interaction.guild) {
        return interaction.reply({ content: "This command can only be used in a server."});
      }    
      if (!queue || queue.songs.length < 3) {
        return interaction.reply({ content: 'Not enough songs in the queue to move.' });
      }
      const from = interaction.options.getInteger('from');
      const to = interaction.options.getInteger('to');
      if (from < 2 || from > queue.songs.length || to < 2 || to > queue.songs.length) {
        return interaction.reply({ content: 'Invalid positions provided.' });
      }
      const [moved] = queue.songs.splice(from - 1, 1);
      queue.songs.splice(to - 1, 0, moved);
      return interaction.reply(`Moved **${moved.title}** from position ${from} to ${to}.`);
    }

    // /jump command: jump to a specific song in the queue
    case 'jump': {
      if (!interaction.guild) {
        return interaction.reply({ content: "This command can only be used in a server."});
      }    
      if (!queue || queue.songs.length < 2) {
        return interaction.reply({ content: 'There are no songs to jump to.' });
      }
      const index = interaction.options.getInteger('index');
      if (index < 2 || index > queue.songs.length) {
        return interaction.reply({ content: 'Invalid index provided.' });
      }
      queue.songs.splice(0, index - 1);
      queue.votes = [];
      queue.player.stop();
      return interaction.reply(`Jumping to **${queue.songs[0].title}**.`);
    }

    // /skip command: immediate skip (restricted to requester, DJ, or owner)
    case 'skip': {
      if (!interaction.guild) {
        return interaction.reply({ content: "This command can only be used in a server."});
      }    
      if (!queue || queue.songs.length === 0) {
        return interaction.reply({ content: 'There is no song playing.' });
      }
      if (queue.songs[0].requester === interaction.user.id || isDJ(interaction)) {
        queue.player.stop();
        return interaction.reply('Song skipped.');
      } else {
        return interaction.reply({ content: 'You do not have permission to skip directly. Use /voteskip instead.' });
      }
    }

    case 'stop': {
      if (!interaction.guild) {
        return interaction.reply({ content: "This command can only be used in a server."});
      }    
      if (!queue) return interaction.reply({ content: 'There is no active queue.' });
      queue.songs = [];
      queue.player.stop();
      queue.connection.destroy();
      queueMap.delete(guildId);
      return interaction.reply('Playback stopped and queue cleared.');
    }

    case 'pause': {
      if (!interaction.guild) {
        return interaction.reply({ content: "This command can only be used in a server."});
      }    
      if (!queue) return interaction.reply({ content: 'There is no active queue.' });
      queue.player.pause();
      return interaction.reply('Playback paused.');
    }

    case 'resume': {
      if (!interaction.guild) {
        return interaction.reply({ content: "This command can only be used in a server."});
      }    
      if (!queue) return interaction.reply({ content: 'There is no active queue.' });
      queue.player.unpause();
      return interaction.reply('Playback resumed.');
    }

    // /queue command with rich embed, pagination buttons, and clickable hyperlinks
    case 'queue': {
      if (!interaction.guild) {
        return interaction.reply({ content: "This command can only be used in a server."});
      }    
      if (!queue || queue.songs.length === 0) {
        return interaction.reply({ content: 'The queue is empty.' });
      }
      // Defer reply for paginated embed update
      await interaction.deferReply();

      let currentPage = 0;
      const itemsPerPage = 10;
      const totalPages = Math.ceil(queue.songs.length / itemsPerPage);

      function generateEmbed(page) {
        const start = page * itemsPerPage;
        const currentSongs = queue.songs.slice(start, start + itemsPerPage);
        const embed = new EmbedBuilder()
          .setTitle('Current Queue')
          .setDescription(currentSongs.map((song, index) => {
            // Use sourceUrl if available; fallback to song.url
            return `${start + index + 1}. [${song.title}](${song.sourceUrl ? song.sourceUrl : song.url})${(start + index === 0) ? ' (Now Playing)' : ''}${song.duration ? ` [${formatDuration(song.duration)}]` : ''}`;
          }).join('\n'))
          .setFooter({ text: `Page ${page + 1} of ${totalPages}` });
        return embed;
      }

      const embed = generateEmbed(currentPage);
      const prevButton = new ButtonBuilder()
        .setCustomId('queue_prev')
        .setLabel('Previous')
        .setStyle(ButtonStyle.Primary)
        .setDisabled(currentPage === 0);
      const nextButton = new ButtonBuilder()
        .setCustomId('queue_next')
        .setLabel('Next')
        .setStyle(ButtonStyle.Primary)
        .setDisabled(currentPage >= totalPages - 1);
      const row = new ActionRowBuilder().addComponents(prevButton, nextButton);

      await interaction.editReply({ embeds: [embed], components: [row] });
      const message = await interaction.fetchReply();
      const collector = message.createMessageComponentCollector({ componentType: ComponentType.Button, time: 60000 });

      collector.on('collect', async i => {
        if (i.user.id !== interaction.user.id) {
          return i.reply({ content: 'These buttons aren\'t for you!', ephemeral: true });
        }
        if (i.customId === 'queue_prev') {
          currentPage = Math.max(currentPage - 1, 0);
        } else if (i.customId === 'queue_next') {
          currentPage = Math.min(currentPage + 1, totalPages - 1);
        }
        const updatedEmbed = generateEmbed(currentPage);
        prevButton.setDisabled(currentPage === 0);
        nextButton.setDisabled(currentPage >= totalPages - 1);
        const updatedRow = new ActionRowBuilder().addComponents(prevButton, nextButton);
        await i.update({ embeds: [updatedEmbed], components: [updatedRow] });
      });

      collector.on('end', async () => {
        prevButton.setDisabled(true);
        nextButton.setDisabled(true);
        const disabledRow = new ActionRowBuilder().addComponents(prevButton, nextButton);
        await interaction.editReply({ components: [disabledRow] });
      });
      break;
    }

    case 'np': {
      if (!interaction.guild) {
        return interaction.reply({ content: "This command can only be used in a server."});
      }    
      if (!queue || queue.songs.length === 0) {
        return interaction.reply({ content: 'No song is currently playing.' });
      }
      const song = queue.songs[0];
      let msg = `**Now Playing:** ${song.title}`;
      if (song.duration) msg += ` [${formatDuration(song.duration)}]`;
      msg += `\nRequested by: <@${song.requester}>`;
      return interaction.reply(msg);
    }

    case 'volume': {
      if (!interaction.guild) {
        return interaction.reply({ content: "This command can only be used in a server."});
      }    
      if (!queue) return interaction.reply({ content: 'There is no active queue.' });
      const level = interaction.options.getNumber('level');
      if (level < 0 || level > 5) {
        return interaction.reply({ content: 'Volume must be between 0.0 and 5.0.' });
      }
      queue.volume = level;
      if (queue.resource && queue.resource.volume) {
        queue.resource.volume.setVolume(level);
      }
      return interaction.reply(`Volume set to ${level}`);
    }

    case 'loop': {
      if (!interaction.guild) {
        return interaction.reply({ content: "This command can only be used in a server."});
      }    
      if (!queue) return interaction.reply({ content: 'There is no active queue.' });
      queue.loop = !queue.loop;
      return interaction.reply(`Looping is now ${queue.loop ? 'enabled' : 'disabled'}.`);
    }

    case 'shuffle': {
      if (!interaction.guild) {
        return interaction.reply({ content: "This command can only be used in a server."});
      }    
      if (!queue || queue.songs.length < 2) {
        return interaction.reply({ content: 'Not enough songs in the queue to shuffle.' });
      }
      const current = queue.songs.shift();
      for (let i = queue.songs.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [queue.songs[i], queue.songs[j]] = [queue.songs[j], queue.songs[i]];
      }
      queue.songs.unshift(current);
      return interaction.reply('Queue shuffled.');
    }

    case 'clear': {
      if (!interaction.guild) {
        return interaction.reply({ content: "This command can only be used in a server."});
      }    
      if (!queue) return interaction.reply({ content: 'There is no active queue.' });
      queue.songs = queue.songs.slice(0, 1);
      return interaction.reply('Cleared the queue (except the currently playing song).');
    }

    case 'refreshcommands': {
      if (interaction.user.id !== BOT_OWNER_ID) {
        return interaction.reply({ content: 'Only the bot owner can refresh commands.' });
      }
      const rest = new REST({ version: '10' }).setToken(BOT_TOKEN);
      try {
        await rest.put(Routes.applicationCommands(client.user.id), { body: [] });
        return interaction.reply('All global commands have been removed. Changes may take up to an hour to propagate.');
      } catch (error) {
        console.error(error);
        return interaction.reply({ content: 'There was an error refreshing commands.', ephemeral: true });
      }
    }

    case 'help': {
      const helpMessage = `
**Music Bot Commands:**
/play — Play a video, playlist, or Spotify track/playlist/album by URL or search term  
/search — Search YouTube interactively  
/voteskip — Vote to skip the current song  
/skip — Force skip (requester/DJ only)  
/stop — Stop playback and clear the queue  
/pause — Pause playback  
/resume — Resume playback  
/queue — Show the current queue (with pagination and clickable links)  
/np — Show now-playing details  
/volume — Set playback volume (0.0 to 5.0)  
/loop — Toggle looping of the current song  
/shuffle — Shuffle the queue  
/clear — Clear the queue (except current song)  
/remove — Remove a song from the queue by position  
/move — Move a song in the queue  
/jump — Jump to a specific song  
/refreshcommands — Remove all global commands (owner only)
      `;
      return interaction.reply(helpMessage);
    }

    default:
      return interaction.reply({ content: 'Unknown command.', ephemeral: true });
  }
});

// New listener: Reply "hi!" when the bot is mentioned.
client.on('messageCreate', message => {
  // Ignore messages from bots.
  if (message.author.bot) return;
  // Check if the bot is mentioned.
  if (message.mentions.has(client.user)) {
    message.reply('Fuck You!');
  }
});

client.login(BOT_TOKEN);
