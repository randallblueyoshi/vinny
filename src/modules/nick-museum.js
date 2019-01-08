module.exports = {
	init: function({ config }) {
		return {
			onMemberEdit: function({ prev, next, dclient }) {
				if (prev.nickname === next.nickname) return;
				dclient.channels
					.get(config.channel)
					.send(`${next.user.tag}: ${next.nickname}`);
			}
		};
	}
};
