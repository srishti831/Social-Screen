import * as roomService from './roomService.js';
import * as messageService from './messageService.js';
import * as historyService from './historyService.js';

/** Everything the WebSocket layer needs from the database, in one injectable object. */
export const persistence = { ...roomService, ...messageService, ...historyService };
