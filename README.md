# spellHelper
Widget based on user js for automatic spelling on pages viewed. Powered by Yandex.Speller

Скрипт позволяет проверять орфографию на сайте в автоматическом режиме. Полезно для контент-менеджеров / копирайтеров. 

Представляет собой виджет, располагающийся в правой части окна браузера

В чём отличие от существующих решений?
- Выше точность распознавания ошибок (в обработку отправляются не отдельные слова, а группы предложений)
- Автопроверка на желаемых доменах либо принудительно на каждом посещаемом
- Фильтр автопроверки по url
- Возможность проверки произвольных элементов (например, метатегов)
- Словарь (в пределах домена, полезно для игнорирования заведомо неверно определяемых слов)
- Часть операций перенесена в воркер, скрипт не должен сильно тормозить браузер
- Лёгкий и ненавязчивый интерфейс
- Возможность запуска в <почти> любом любимом браузере
- Код открыт и свободно доступен для модификаций / настроек

Проверка производится с помощью Яндекс.Спеллера, кроме него сторонних сервисов не используется.

Оформлено в виде пользовательского JS, для использования необходимо любое расширение, запускающее пользовательские скрипты.
Например,
Chrome: "User JavaScript And CSS" (https://chrome.google.com/webstore/detail/user-javascript-and-css/nbhcbdghjpllgmfilhnhkllmkecfmpld)
