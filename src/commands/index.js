const subscriptionCommand = require('./subscription');
const settingsCommand = require('./settings');
const adminCommand = require('./admin');
const helpCommand = require('./help');
const downloadCommand = require('./download');
const logger = require('../utils/logger');

class CommandManager {
    constructor() {
        this.commands = [
            subscriptionCommand,
            settingsCommand,
            adminCommand,
            helpCommand,
            downloadCommand,
        ];
    }

    getCommandLabel(rawMessage) {
        const trimmed = String(rawMessage || '').trim();
        if (!trimmed.startsWith('/')) return '';
        return trimmed.split(/\s+/).slice(0, 2).join(' ');
    }

    async dispatch(context) {
        const scope = context?.traceContext?.scope || '';
        const command = this.getCommandLabel(context?.rawMessage);
        if (command) {
            logger.logEvent('info', 'BOT', scope, 'command-dispatch', {
                command
            });
        }
        for (const command of this.commands) {
            try {
                const handled = await command.handle(context);
                if (handled) {
                    if (scope) {
                        logger.logEvent('info', 'BOT', scope, 'command-handled', {
                            command: this.getCommandLabel(context?.rawMessage),
                            handler: command.constructor?.name || 'UnknownCommand'
                        });
                    }
                    return true;
                }
            } catch (e) {
                logger.logEvent('error', 'BOT', scope, 'command-failed', {
                    command: this.getCommandLabel(context?.rawMessage),
                    handler: command.constructor?.name || 'UnknownCommand',
                    error: logger.getErrorMessage(e)
                });
            }
        }
        return false;
    }
}

module.exports = new CommandManager();
