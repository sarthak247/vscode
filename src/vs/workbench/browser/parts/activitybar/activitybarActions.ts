/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./media/activityaction';
import * as DOM from 'vs/base/browser/dom';
import { EventType as TouchEventType, GestureEvent } from 'vs/base/browser/touch';
import { Action } from 'vs/base/common/actions';
import { IContextMenuService } from 'vs/platform/contextview/browser/contextView';
import { ViewletDescriptor } from 'vs/workbench/browser/viewlet';
import { IActivity, IGlobalActivity } from 'vs/workbench/common/activity';
import { dispose } from 'vs/base/common/lifecycle';
import { IViewletService, } from 'vs/workbench/services/viewlet/browser/viewlet';
import { IPartService, Parts } from 'vs/workbench/services/part/common/partService';
import { IThemeService, ITheme, registerThemingParticipant, ICssStyleCollector } from 'vs/platform/theme/common/themeService';
import { activeContrastBorder, focusBorder } from 'vs/platform/theme/common/colorRegistry';
import { StandardMouseEvent } from 'vs/base/browser/mouseEvent';
import { KeyCode } from 'vs/base/common/keyCodes';
import { StandardKeyboardEvent } from 'vs/base/browser/keyboardEvent';
import { ActivityAction, ActivityActionItem, ICompositeBarColors, ToggleCompositePinnedAction, ICompositeBar } from 'vs/workbench/browser/parts/compositeBarActions';
import { ITelemetryService } from 'vs/platform/telemetry/common/telemetry';
import { URI } from 'vs/base/common/uri';
import { ACTIVITY_BAR_FOREGROUND } from 'vs/workbench/common/theme';

export class ViewletActivityAction extends ActivityAction {

	private static readonly preventDoubleClickDelay = 300;

	private lastRun: number = 0;

	constructor(
		activity: IActivity,
		@IViewletService private viewletService: IViewletService,
		@IPartService private partService: IPartService,
		@ITelemetryService private telemetryService: ITelemetryService
	) {
		super(activity);
	}

	run(event: any): Thenable<any> {
		if (event instanceof MouseEvent && event.button === 2) {
			return Promise.resolve(false); // do not run on right click
		}

		// prevent accident trigger on a doubleclick (to help nervous people)
		const now = Date.now();
		if (now > this.lastRun /* https://github.com/Microsoft/vscode/issues/25830 */ && now - this.lastRun < ViewletActivityAction.preventDoubleClickDelay) {
			return Promise.resolve(true);
		}
		this.lastRun = now;

		const sideBarVisible = this.partService.isVisible(Parts.SIDEBAR_PART);
		const activeViewlet = this.viewletService.getActiveViewlet();

		// Hide sidebar if selected viewlet already visible
		if (sideBarVisible && activeViewlet && activeViewlet.getId() === this.activity.id) {
			this.logAction('hide');
			return this.partService.setSideBarHidden(true);
		}

		this.logAction('show');
		return this.viewletService.openViewlet(this.activity.id, true).then(() => this.activate());
	}

	private logAction(action: string) {
		/* __GDPR__
			"activityBarAction" : {
				"viewletId": { "classification": "SystemMetaData", "purpose": "FeatureInsight" },
				"action": { "classification": "SystemMetaData", "purpose": "FeatureInsight" }
			}
		*/
		this.telemetryService.publicLog('activityBarAction', { viewletId: this.activity.id, action });
	}
}

export class ToggleViewletAction extends Action {

	constructor(
		private _viewlet: ViewletDescriptor,
		@IPartService private partService: IPartService,
		@IViewletService private viewletService: IViewletService
	) {
		super(_viewlet.id, _viewlet.name);
	}

	run(): Thenable<any> {
		const sideBarVisible = this.partService.isVisible(Parts.SIDEBAR_PART);
		const activeViewlet = this.viewletService.getActiveViewlet();

		// Hide sidebar if selected viewlet already visible
		if (sideBarVisible && activeViewlet && activeViewlet.getId() === this._viewlet.id) {
			return this.partService.setSideBarHidden(true);
		}

		return this.viewletService.openViewlet(this._viewlet.id, true);
	}
}

export class GlobalActivityAction extends ActivityAction {

	constructor(activity: IGlobalActivity) {
		super(activity);
	}
}

export class GlobalActivityActionItem extends ActivityActionItem {

	constructor(
		action: GlobalActivityAction,
		colors: (theme: ITheme) => ICompositeBarColors,
		@IThemeService themeService: IThemeService,
		@IContextMenuService protected contextMenuService: IContextMenuService
	) {
		super(action, { draggable: false, colors, icon: true }, themeService);
	}

	render(container: HTMLElement): void {
		super.render(container);

		// Context menus are triggered on mouse down so that an item can be picked
		// and executed with releasing the mouse over it

		this._register(DOM.addDisposableListener(this.container, DOM.EventType.MOUSE_DOWN, (e: MouseEvent) => {
			DOM.EventHelper.stop(e, true);

			const event = new StandardMouseEvent(e);
			this.showContextMenu({ x: event.posx, y: event.posy });
		}));

		this._register(DOM.addDisposableListener(this.container, DOM.EventType.KEY_UP, (e: KeyboardEvent) => {
			let event = new StandardKeyboardEvent(e);
			if (event.equals(KeyCode.Enter) || event.equals(KeyCode.Space)) {
				DOM.EventHelper.stop(e, true);

				this.showContextMenu(this.container);
			}
		}));

		this._register(DOM.addDisposableListener(this.container, TouchEventType.Tap, (e: GestureEvent) => {
			DOM.EventHelper.stop(e, true);

			const event = new StandardMouseEvent(e);
			this.showContextMenu({ x: event.posx, y: event.posy });
		}));
	}

	private showContextMenu(location: HTMLElement | { x: number, y: number }): void {
		const globalAction = this._action as GlobalActivityAction;
		const activity = globalAction.activity as IGlobalActivity;
		const actions = activity.getActions();

		this.contextMenuService.showContextMenu({
			getAnchor: () => location,
			getActions: () => Promise.resolve(actions),
			onHide: () => dispose(actions)
		});
	}
}

export class PlaceHolderViewletActivityAction extends ViewletActivityAction {

	constructor(
		id: string, iconUrl: URI,
		@IViewletService viewletService: IViewletService,
		@IPartService partService: IPartService,
		@ITelemetryService telemetryService: ITelemetryService
	) {
		super({ id, name: id, cssClass: `extensionViewlet-placeholder-${id.replace(/\./g, '-')}` }, viewletService, partService, telemetryService);

		const iconClass = `.monaco-workbench > .activitybar .monaco-action-bar .action-label.${this.class}`; // Generate Placeholder CSS to show the icon in the activity bar
		DOM.createCSSRule(iconClass, `-webkit-mask: url('${iconUrl || ''}') no-repeat 50% 50%`);
	}

	setActivity(activity: IActivity): void {
		this.activity = activity;
	}
}

export class PlaceHolderToggleCompositePinnedAction extends ToggleCompositePinnedAction {

	constructor(id: string, compositeBar: ICompositeBar) {
		super({ id, name: id, cssClass: void 0 }, compositeBar);
	}

	setActivity(activity: IActivity): void {
		this.label = activity.name;
	}
}

registerThemingParticipant((theme: ITheme, collector: ICssStyleCollector) => {

	const activeForegroundColor = theme.getColor(ACTIVITY_BAR_FOREGROUND);
	if (activeForegroundColor) {
		collector.addRule(`
			.monaco-workbench > .activitybar > .content .monaco-action-bar .action-item.active .action-label,
			.monaco-workbench > .activitybar > .content .monaco-action-bar .action-item:focus .action-label,
			.monaco-workbench > .activitybar > .content .monaco-action-bar .action-item:hover .action-label {
				background-color: ${activeForegroundColor} !important;
			}
		`);
	}

	// Styling with Outline color (e.g. high contrast theme)
	const outline = theme.getColor(activeContrastBorder);
	if (outline) {
		collector.addRule(`
			.monaco-workbench > .activitybar > .content .monaco-action-bar .action-item:before {
				content: "";
				position: absolute;
				top: 9px;
				left: 9px;
				height: 32px;
				width: 32px;
			}

			.monaco-workbench > .activitybar > .content .monaco-action-bar .action-item.active:before,
			.monaco-workbench > .activitybar > .content .monaco-action-bar .action-item.active:hover:before,
			.monaco-workbench > .activitybar > .content .monaco-action-bar .action-item.checked:before,
			.monaco-workbench > .activitybar > .content .monaco-action-bar .action-item.checked:hover:before {
				outline: 1px solid;
			}

			.monaco-workbench > .activitybar > .content .monaco-action-bar .action-item:hover:before {
				outline: 1px dashed;
			}

			.monaco-workbench > .activitybar > .content .monaco-action-bar .action-item:focus:before {
				border-left-color: ${outline};
			}

			.monaco-workbench > .activitybar > .content .monaco-action-bar .action-item.active:before,
			.monaco-workbench > .activitybar > .content .monaco-action-bar .action-item.active:hover:before,
			.monaco-workbench > .activitybar > .content .monaco-action-bar .action-item.checked:before,
			.monaco-workbench > .activitybar > .content .monaco-action-bar .action-item.checked:hover:before,
			.monaco-workbench > .activitybar > .content .monaco-action-bar .action-item:hover:before {
				outline-color: ${outline};
			}
		`);
	}

	// Styling without outline color
	else {
		const focusBorderColor = theme.getColor(focusBorder);
		if (focusBorderColor) {
			collector.addRule(`
					.monaco-workbench > .activitybar > .content .monaco-action-bar .action-item:focus:before {
						border-left-color: ${focusBorderColor};
					}
				`);
		}
	}
});
