'use strict';

var CourseCalendar = (function () {
    function CourseCalendar(element, options) {
        this.element = element;
        this.courseManager = options.courseManager;
        this.colorGenerator = options.colorGenerator;
        this.icsFileName = options.icsFileName;
        this.onCourseHoverIn = options.onCourseHoverIn;
        this.onCourseHoverOut = options.onCourseHoverOut;
        this.onCourseConflictedStatusChanged = options.onCourseConflictedStatusChanged;
        this.onLessonSelected = options.onLessonSelected;
        this.onLessonUnselected = options.onLessonUnselected;

        element.addClass('course-calendar').fullCalendar({
            defaultDate: '2017-01-01',
            //editable: true,
            //eventLimit: true, // allow "more" link when too many events
            defaultView: 'agendaWeek',
            header: false,
            allDaySlot: false,
            minTime: '08:30:00',
            maxTime: '18:30:00',
            height: 'auto',
            contentHeight: 'auto',
            columnFormat: 'dddd',
            locale: 'he',
            slotEventOverlap: false,
            displayEventTime: false,
            eventClick: onEventClick.bind(this),
            eventMouseover: onEventMouseover.bind(this),
            eventMouseout: onEventMouseout.bind(this),
            eventAfterRender: afterEventRender.bind(this)
        }).fullCalendar('option', {
            // Set afterwards as a bug workaround.
            // https://github.com/fullcalendar/fullcalendar/issues/4102
            hiddenDays: [5, 6]
        });
    }

    function rishumTimeParse(time) {
        var match = /^(\d+)(:\d+)? - (\d+)(:\d+)?$/.exec(time);
        var startHour = ('00' + match[1]).slice(-2);
        var startMinute = '00';
        if (match[2] !== undefined) {
            startMinute = (match[2] + '00').slice(1, 3);
        }
        var start = startHour + ':' + startMinute;

        var endHour = ('00' + match[3]).slice(-2);
        var endMinute = '00';
        if (match[4] !== undefined) {
            endMinute = (match[4] + '00').slice(1, 3);
        }
        var end = endHour + ':' + endMinute;

        return { start: start, end: end };
    }

    function stringHexEncode(str) {
        var result = '';
        for (var i=0; i<str.length; i++) {
            var hex = str.charCodeAt(i).toString(16);
            result += ('000'+hex).slice(-4);
        }
        return result;
    }

    function getLessonType(courseNumber, lesson) {
        // Sport courses have a non-standard format, treat all of the lessons as the same type.
        if (/^394[89]\d\d$/.test(courseNumber)) {
            return 'sport';
        } else {
            return stringHexEncode(lesson['סוג']);
        }
    }

    function getEventLessonType(event) {
        return getLessonType(event.courseNumber, event.lessonData);
    }

    function myUpdateEvents(calendar, events) {
        events = events.slice(); // make a copy
        events.forEach(function (value, index) {
            events[index] = $.extend({}, events[index]); // make a copy

            // Delete properties which are not shared among events with the same id.
            delete events[index].title;
            delete events[index].lessonData;
        });
        calendar.fullCalendar('updateEvents', events);
    }

    function myUpdateEvent(calendar, event) {
        myUpdateEvents(calendar, [event]);
    }

    function getCourseConflictedStatus(calendar, course) {
        var availableOptionsPerType = {};

        calendar.fullCalendar('clientEvents', function (event) {
            if (event.courseNumber !== course) {
                return false;
            }

            var type = getLessonType(course, event.lessonData);
            if (!availableOptionsPerType.propertyIsEnumerable(type)) {
                availableOptionsPerType[type] = 0;
            }

            if (event.start.week() === 1) {
                availableOptionsPerType[type]++;
            }

            return false;
        });

        var conflicted = false;

        Object.keys(availableOptionsPerType).some(function (type) {
            if (availableOptionsPerType[type] === 0) {
                conflicted = true;
                return true;
            }
            return false;
        });

        return conflicted;
    }

    function updateCalendarMaxDayAndTime(calendar) {
        var minTime = calendar.fullCalendar('getCalendar').moment('2017-01-01T08:30:00');
        var maxTime = calendar.fullCalendar('getCalendar').moment('2017-01-01T18:30:00');
        var friday = false;

        calendar.fullCalendar('clientEvents', function (event) {
            if (event.start.day() === 5) {
                friday = true;
            }

            var start = event.start.clone().set({ year: 2017, month: 0, date: 1 });
            var end = event.end.clone().set({ year: 2017, month: 0, date: 1 });

            // Fix-up for 24:00 which is treated as 00:00 of the next day.
            if (end.hour() === 0 && end.minute() === 0) {
                end.hour(24);
            }

            if (minTime.isAfter(start)) {
                minTime = start;
            }

            if (maxTime.isBefore(end)) {
                maxTime = end;
            }

            return false;
        });

        minTime = minTime.format('kk:mm:ss');
        maxTime = maxTime.format('kk:mm:ss');
        var hiddenDays = friday ? [6] : [5, 6];

        // Only apply options that changed, avoids re-rendering if not needed, which is very slow.
        var newOptions = {};

        if (minTime !== calendar.fullCalendar('option', 'minTime')) {
            newOptions['minTime'] = minTime;
        }

        if (maxTime !== calendar.fullCalendar('option', 'maxTime')) {
            newOptions['maxTime'] = maxTime;
        }

        if (JSON.stringify(hiddenDays) !== JSON.stringify(calendar.fullCalendar('option', 'hiddenDays'))) {
            newOptions['hiddenDays'] = hiddenDays;
        }

        if (Object.keys(newOptions).length > 0) {
            calendar.fullCalendar('option', newOptions);
        }
    }

    function areEventsOverlapping(event1, event2) {
        if (event1.start.day() !== event2.start.day()) {
            return false;
        }

        var startTime1 = event1.start.clone().year(0).month(0).date(1);
        var endTime1 = event1.end.clone().year(0).month(0).date(1);
        var startTime2 = event2.start.clone().year(0).month(0).date(1);
        var endTime2 = event2.end.clone().year(0).month(0).date(1);

        return startTime1.isBefore(endTime2) && endTime1.isAfter(startTime2);
    }

    function onEventClick(event) {
        var that = this;
        var calendar = that.element;

        var selectingEvent = !event.selected;
        var conflictedCourses = {};

        if (selectingEvent) {
            that.onLessonSelected(event.courseNumber, event.lessonData['מס.'], getEventLessonType(event));
            event.selected = true;
            event.backgroundColor = that.colorGenerator(event.courseNumber);
            event.textColor = 'white';
            event.borderColor = 'white';
        } else {
            that.onLessonUnselected(event.courseNumber, event.lessonData['מס.'], getEventLessonType(event));
            event.selected = false;
            event.backgroundColor = '#F8F9FA';
            event.textColor = 'black';
            event.borderColor = 'black';
        }
        myUpdateEvent(calendar, event);

        var sameCourseTypeEvents = calendar.fullCalendar('clientEvents', function (cbEvent) {
            if (cbEvent.courseNumber === event.courseNumber &&
                getEventLessonType(cbEvent) === getEventLessonType(event)) {

                if (cbEvent.lessonData['מס.'] === event.lessonData['מס.']) {
                    // There might be multiple events for the same course, type, and number, process them all.
                    handleConflictedEvents(cbEvent);
                    return false;
                } else {
                    return true;
                }
            }
            return false;
        });

        for (var i = 0; i < sameCourseTypeEvents.length; i++) {
            sameCourseTypeEvents[i].start.add(selectingEvent ? 7 : -7, 'days');
            sameCourseTypeEvents[i].end.add(selectingEvent ? 7 : -7, 'days');
        }

        myUpdateEvents(calendar, sameCourseTypeEvents);

        Object.keys(conflictedCourses).forEach(function (conflictedCourse) {
            var conflicted = getCourseConflictedStatus(calendar, conflictedCourse);
            that.onCourseConflictedStatusChanged(conflictedCourse, conflicted);
        });

        function handleConflictedEvents(event) {
            var conflictedIds = {};

            var conflictedEvents = calendar.fullCalendar('clientEvents', function (cbEvent) {
                if (cbEvent.courseNumber === event.courseNumber &&
                    getEventLessonType(cbEvent) === getEventLessonType(event)) {
                    return false;
                }

                if (areEventsOverlapping(cbEvent, event)) {
                    if (!conflictedIds.propertyIsEnumerable(cbEvent.id)) {
                        conflictedIds[cbEvent.id] = 1;
                        return true;
                    }
                    conflictedIds[cbEvent.id]++;
                    return false;
                }

                return false;
            });

            for (var i = 0; i < conflictedEvents.length; i++) {
                var weeks = conflictedIds[conflictedEvents[i].id];
                conflictedEvents[i].start.add((selectingEvent ? 7 : -7)*weeks, 'days');
                conflictedEvents[i].end.add((selectingEvent ? 7 : -7)*weeks, 'days');
                conflictedCourses[conflictedEvents[i].courseNumber] = true;
            }

            myUpdateEvents(calendar, conflictedEvents);
        }
    }

    function onEventMouseover(event) {
        $('.calendar-item-course-' + event.courseNumber).addClass('calendar-item-same-course-as-hovered');
        $('.calendar-item-course-' + event.courseNumber + '-type-' + getEventLessonType(event)).addClass('calendar-item-same-type-as-hovered');
        this.onCourseHoverIn(event.courseNumber);
    }

    function onEventMouseout(event) {
        $('.calendar-item-course-' + event.courseNumber).removeClass('calendar-item-same-course-as-hovered');
        $('.calendar-item-course-' + event.courseNumber + '-type-' + getEventLessonType(event)).removeClass('calendar-item-same-type-as-hovered');
        this.onCourseHoverOut(event.courseNumber);
    }

    function afterEventRender(event, element) {
        if (!event.selected) {
            var sameType = $('.calendar-item-course-' + event.courseNumber + '-type-' + getEventLessonType(event))
                .not('.calendar-item-course-' + event.courseNumber + '-lesson-' + event.lessonData['מס.']);
            if (sameType.length === 0) {
                element.addClass('calendar-item-last-choice');
            }
        }
    }

    CourseCalendar.prototype.addCourse = function (course) {
        var that = this;
        
        var general = that.courseManager.getGeneralInfo(course);
        var schedule = that.courseManager.getSchedule(course);
        if (schedule.length === 0) {
            return;
        }

        var calendar = that.element;

        var lessonsAdded = {};
        var events = [];
        var conflictedIds = {};

        for (var i = 0; i < schedule.length; i++) {
            var lesson = schedule[i];
            if (lessonsAdded.propertyIsEnumerable(lesson['מס.']) && lessonsAdded[lesson['מס.']] !== lesson['קבוצה']) {
                continue;
            }

            events.push(makeLessonEvent(lesson));
            lessonsAdded[lesson['מס.']] = lesson['קבוצה'];
        }

        for (i = 0; i < events.length; i++) {
            if (conflictedIds.propertyIsEnumerable(events[i].id)) {
                var weeks = conflictedIds[events[i].id];
                events[i].start.add(7*weeks, 'days');
                events[i].end.add(7*weeks, 'days');
            }
        }

        calendar.fullCalendar('renderEvents', events);

        if (Object.keys(conflictedIds).length > 0 && getCourseConflictedStatus(calendar, course)) {
            that.onCourseConflictedStatusChanged(course, true);
        }

        updateCalendarMaxDayAndTime(calendar);

        function makeLessonEvent(lesson) {
            var lessonType = getLessonType(course, lesson);
            var lessonDay = lesson['יום'].charCodeAt(0) - 'א'.charCodeAt(0) + 1;
            var lessonStartEnd = rishumTimeParse(lesson['שעה']);
            var eventStartEnd = {
                start: calendar.fullCalendar('getCalendar').moment('2017-01-0' + lessonDay + 'T' + lessonStartEnd['start'] + ':00'),
                end: calendar.fullCalendar('getCalendar').moment('2017-01-0' + lessonDay + 'T' + lessonStartEnd['end'] + ':00')
            };

            var eventId = course + '.' + lesson['מס.'] + '.' + lessonType;

            var title = lesson['סוג'] + ' ' + lesson['מס.'];
            if (lesson['סוג'] === 'sadna') {
                title = 'סדנה';
            }
            if (lesson['בניין'] !== '') {
                title += '\n' + lesson['בניין'];
                if (lesson['חדר'] !== '') {
                    title += ' ' + lesson['חדר'];
                }
            }
            if (lesson['מרצה/מתרגל'] !== '') {
                title += '\n' + lesson['מרצה/מתרגל'];
            }
            title += '\n' + general['שם מקצוע'];

            // Mark conflicting events which cannot be selected.
            calendar.fullCalendar('clientEvents', function (cbEvent) {
                if (cbEvent.selected && areEventsOverlapping(cbEvent, eventStartEnd)) {
                    if (!conflictedIds.propertyIsEnumerable(eventId)) {
                        conflictedIds[eventId] = 0;
                    }
                    conflictedIds[eventId]++;
                }
                return false;
            });

            return {
                id: eventId,
                title: title,
                start: eventStartEnd.start,
                end: eventStartEnd.end,
                backgroundColor: '#F8F9FA',
                textColor: 'black',
                borderColor: 'black',
                className: 'calendar-item-course-' + course
                    + ' calendar-item-course-' + course + '-type-' + lessonType
                    + ' calendar-item-course-' + course + '-lesson-' + lesson['מס.'],
                courseNumber: course,
                lessonData: lesson,
                selected: false,
                temporary: false
            };
        }
    };

    CourseCalendar.prototype.removeCourse = function (course) {
        var that = this;
        var calendar = that.element;

        // Show conflicting events which can now be selected.
        var conflictedIds = {};

        var conflictedEvents = calendar.fullCalendar('clientEvents', function (event) {
            if (event.courseNumber !== course && isConflicted(event, course)) {
                if (!conflictedIds.propertyIsEnumerable(event.id)) {
                    conflictedIds[event.id] = 1;
                    return true;
                }
                conflictedIds[event.id]++;
                return false;
            }

            return false;
        });

        var conflictedCourses = {};

        for (var i = 0; i < conflictedEvents.length; i++) {
            var weeks = conflictedIds[conflictedEvents[i].id];
            conflictedEvents[i].start.add(-7*weeks, 'days');
            conflictedEvents[i].end.add(-7*weeks, 'days');
            conflictedCourses[conflictedEvents[i].courseNumber] = true;
        }

        myUpdateEvents(calendar, conflictedEvents);
        calendar.fullCalendar('removeEvents', function (event) {
            return event.courseNumber === course;
        });

        Object.keys(conflictedCourses).forEach(function (conflictedCourse) {
            var conflicted = getCourseConflictedStatus(calendar, conflictedCourse);
            that.onCourseConflictedStatusChanged(conflictedCourse, conflicted);
        });

        updateCalendarMaxDayAndTime(calendar);

        // True if the event cannot be selected because of the given course.
        function isConflicted(event, course) {
            var conflictingEvent = calendar.fullCalendar('clientEvents', function (cbEvent) {
                return cbEvent.courseNumber === course && cbEvent.selected && areEventsOverlapping(cbEvent, event);
            });

            return conflictingEvent.length > 0;
        }
    };

    CourseCalendar.prototype.previewCourse = function (course) {
        var that = this;
        var calendar = that.element;
        
        var conflictedEvents = calendar.fullCalendar('clientEvents', function (event) {
            return event.courseNumber === course && event.start.week() > 1;
        });

        var temporaryEvents = [];

        for (var i = 0; i < conflictedEvents.length; i++) {
            var conf = conflictedEvents[i];
            var temp = {
                id: 'temp_' + conf.id,
                title: conf.title,
                start: conf.start.clone().week(1),
                end: conf.end.clone().week(1),
                backgroundColor: conf.backgroundColor,
                textColor: conf.textColor,
                borderColor: conf.borderColor,
                className: conf.className,
                courseNumber: conf.courseNumber,
                lessonData: conf.lessonData,
                selected: conf.selected,
                temporary: true
            };

            temporaryEvents.push(temp);
        }

        calendar.fullCalendar('renderEvents', temporaryEvents);

        $('.calendar-item-course-' + course).addClass('calendar-item-previewed');

        if (conflictedEvents.length > 0) {
            updateCalendarMaxDayAndTime(calendar);
        }
    };

    CourseCalendar.prototype.unpreviewCourse = function (course) {
        var that = this;
        var calendar = that.element;

        var removed = 0;

        calendar.fullCalendar('removeEvents', function (event) {
            if (event.temporary && event.courseNumber === course) {
                removed++;
                return true;
            } else {
                return false;
            }
        });

        $('.calendar-item-course-' + course).removeClass('calendar-item-previewed');

        if (removed > 0) {
            updateCalendarMaxDayAndTime(calendar);
        }
    };

    CourseCalendar.prototype.toggleLesson = function (course, lessonType, lessonNumber) {
        $('.calendar-item-course-' + course + '-type-' + lessonType
            + '.calendar-item-course-' + course + '-lesson-' + lessonNumber).first().click();
    };

    CourseCalendar.prototype.saveAsIcs = function () {
        var that = this;
        var calendar = that.element;
        
        var icsCal = ics();

        var yearFrom = parseInt(current_semester.slice(0, 4), 10);
        var yearTo = yearFrom + 2;

        var rrule = { freq: 'WEEKLY', until: yearTo + '-01-01T00:00:00Z' };

        var count = 0;

        calendar.fullCalendar('clientEvents', function (event) {
            if (event.start.week() === 1 && event.selected) {
                var general = that.courseManager.getGeneralInfo(event.courseNumber);
                var lesson = event.lessonData;

                var subject = lesson['סוג'] + ' ' + lesson['מס.'];
                if (lesson['סוג'] === 'sadna') {
                    subject = 'סדנה';
                }
                subject += ' - ' + general['שם מקצוע'];

                var description = '';
                if (lesson['מרצה/מתרגל'] !== '') {
                    description = lesson['מרצה/מתרגל'];
                }

                var location = '';
                if (lesson['בניין'] !== '') {
                    location = lesson['בניין'];
                    if (lesson['חדר'] !== '') {
                        location += ' ' + lesson['חדר'];
                    }
                }

                var begin = event.start.format();
                var end = event.end.format();

                icsCal.addEvent(subject, description, location, begin, end, rrule);
                count++;
            }

            return false;
        });

        if (count === 0) {
            return false;
        }

        icsCal.download(that.icsFileName || 'schedule');
        return true;
    };

    CourseCalendar.prototype.removeAll = function () {
        var that = this;
        var calendar = that.element;

        calendar.fullCalendar('removeEvents', function () {
            return true;
        });

        updateCalendarMaxDayAndTime(calendar);
    };

    return CourseCalendar;
})();