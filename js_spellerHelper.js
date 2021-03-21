// Ограничение одного POST-запроса к Спеллеру - 10000 символов! Поэтому весь извлечённый текст будем дробить на фрагменты, приближенные к лимиту.
// Максимальную длину можно переопределить, переменная postLength (объявлена в начале скрипта). Это будет влиять на чувствительность; обычно, чем ниже значение, тем больше ошибок определяется, но ниже скорость выполнения проверки.
// Также можно задать, какие элементы страницы подлежат проверке (переменная walkSelectors)
// По умолчанию проверка происходит только при открытии виджета.
// Есть возможность автопроверки на заданных доменах. Настраивается в переменной autoDomains
// Можно отключить проверку на страницах, подпадающих под условие - массив globalPathBlacklist или персонально для каждого домена, в autoDomains или в самом виджете
// Также можно принудительно включить автопроверку на всех доменах, для этого нужно раскомментировать строку под объявлением autoDomains
// Поддерживаются настройки запросов к Спеллеру. Объект spellerOptions
// Текст можно собирать двумя путями - через innerText и через обработку innerHTML в воркере. По умолчанию используем второй способ, переключить можно переменной extractHTML
// Если переключаем на простое извлечение текста, рекомендуется держать переменную tryRecoverSents в true, для предотвращения склейки слов из граничащих друг с другом элементов
//
// При первом открытии виджета / при автоматическом запуске собирается текст с каждого из выбранных селекторов и передаётся в воркер. В воркере текст оптимизируется, разбивается на предложения, формируется в фрагменты. После получения ответа от Спеллера возвращает объект с ошибками.
// Строим разметку в основном потоке.
// Ко вниманию принимаются только ошибки, помеченные 'code = 1'. Иногда приходят с кодом = 4, но мной замечены такие срабатывания только на emoji, поэтому отбрасываем их.
// Также можно игнорировать ошибки, не содержащие кириллицу (часто Спеллер возвращает англоязычные слова, несмотря на флаг 'lang'). Включением переменной skipNotCyr можно фильтровать слова без кириллицы. Также она автоматически переводится в true, если в spellerOptions.lang отсутствует 'en'


// Загрузчик, сработает если состояние DOMContentLoaded либо уже load
!function(){function n(){

    var spellerOptions = {
        'lang': 'ru', //'ru,uk,en'
        'options': 12, // int. 4+8 - skip urls + highlight text repeats
        'format': 'plain', // 'plain'/'html'
    };

    var debug = true; // Логировать в консоль

    var autoDomains = { // автозапуск на доменах
        'example.ru': {'forbidden': ['/admin/'], 'whitelist': ['/']}, // todo: whitelist. Сейчас присутствует для демонстрации
        'subdomain.example.su': '', // Пока что поддомены нужно перечислять явным образом
    };
    autoDomains[window.location.host] = ''; // ЖЁСТКИЙ АВТОЗАПУСК ДЛЯ ТЕСТА

    // глобальный фильтр по путям (будет запускаться, но не производить проверку)
    var globalPathBlacklist = [
        '/admin',
        '/wp-admin',
        '/administrator',
        '/edit',
        'vk.com/im', // можно задавать с доменом, а также get-параметрами (проверяем window.location.href)
        'mail.yandex.ru',
        'mail.google.com',
        '?destination=',
    ];
    
    // на этих url даже не будет стартовать виджет
    var excludeList = [
        'amocrm.ru',
        'my.lptracker.ru',
        '/admin/',
        '/admin?',
        '/wp-admin',
        '/administrator',
        '/edit',
        '/node/add/',
        'squoosh.app',
    ];

    var walkSelectors = { // обходить эти селекторы
        'body': '',
        'title': '',
        'meta[name="description"]': 'content', // непустое значение ключа воспринимается как указание извлекать не текст, а атрибут этого элемента
    };

    var skipNotCyr = false; // Пропускать ошибки, не содержащие кириллицу
    if (spellerOptions.lang.indexOf('en') < 0){
        // если в опциях Спеллера en не значится, подавлять вывод ошибок без кириллицы
        skipNotCyr = true;
    }

    var tryRecoverSents = false; // Пытаться разбить "словоСлово" на два предложения

    var extractHTML = true; // Альтернатива предыдущему - извлекаем html, в воркере заменяем теги на пробелы

    var markMistakes = true; // Помечать найденные ошибки

    var highlightSuggestions = true; // Вывод исправлений при наведении

    var postLength = 9000; // Длина текста в одном POST-запросе

    // предопределяем, чтобы потом закешировать сюда выборку
    var widget = false;
    var settingsWind = false;
    var resultsWind = false;



    /**
    * Принимает объект с селектором, извлекает из него текст.
    * Обрабатывает только один элемент по селектору, selector[0]
    * {selector, (опционально) attribute}
    */
    var extractTxt = function(obj){
        return new Promise(function(resolve, reject){
            var selector = obj.selector || false;
            var attr = obj.attribute || false;
            var exHTML = obj.extractHTML || false;

            if (!selector){
                if (debug){
                    console.log('extractTxt(): не передан селектор');
                }
                reject(false); // Если селектор пуст, неоткуда извлекать текст
            }

            var el = document.querySelectorAll(selector);
            if (el.length < 1){
                if (debug){
                    console.log('extractTxt(): не найдено элементов по селектору «'+selector+'»');
                }
                reject(false); // Если селектор пуст, неоткуда извлекать текст
            }

            el = el[0];
            var result = '';

            if (attr && el.hasAttribute(attr)){
                result = el.getAttribute(attr);
            } else {
                if (exHTML){
                    // вернём html, но без служебных элементов
                    var tempEl = document.createElement('div');
                    tempEl.innerHTML = el.innerHTML;
                    var tempQuery = tempEl.querySelectorAll('iframe, script, style, img');
                    if (tempQuery.length > 0){
                        for (var i = 0; i < tempQuery.length; i++){
                            tempQuery[i].parentNode.removeChild(tempQuery[i]);
                        }
                    }
                    result = tempEl.innerHTML;
                    tempEl.innerHTML = '';
                } else {
                    // Если мы просто заберём textContent, будет куча склеенного текста.
                    // А вот innerText вернёт с переносами
                    result = el.innerText;
                }
            }

            if (!result || result === null){
                if (debug){
                    console.log('extractTxt(): для селектора «'+selector+'» result пуст или null');
                }
            }

            resolve(result);
        });
    };

    // Воркер. В воркере мы должны:
    // 1. Удалить множественные переносы строк и пробелы.
    // 2. Нарезать общий текст на массив по переносам строк и точкам/восклицательным/вопросительным через regexp.
    // 3. Можно пробежаться, проверить каждый на дубли
    // 4. Сформировать текст для POST длиной не выше postLength символов.
    // 5. Отправить, получить ответ с кодом ошибки, собрать ошибки, вернуть основному скрипту.

    /**
    * Воркер
    * Получает объект со свойствами 'text', 'postLength', 'selector'
    */
    var workerBlob = window.URL.createObjectURL( new Blob([ '(',
    function(){

        var debug = false; // off by default
        var spellerOpts = false; // default options

        /**
        * Удаляет множественные переносы строк
        */
        var removeMultipleBreaks = function(txt){
            return new Promise(function(resolve, reject){
                if (txt){
                    txt = txt.replace(/(\r\n|\r|\n)+/g, '$1');
                }
                resolve(txt);
            });
        }

        /**
        * Удаляем множественные пробелы
        */
        var removeMultipleSpaces = function(txt){
            return new Promise(function(resolve, reject){
                if (txt){
                    txt = txt.replace(/(\ ){2,}/g, ' ');
                }
                resolve(txt);
            });
        }

        /**
        * В принятом html заменяет теги на пробелы. Пытаемся предотвратить склейку слов
        */
        var preventGluing = function(html){
            return new Promise(function(resolve, reject){
                if (!html){
                    if (debug){
                        console.log('  worker::preventGluing(): html is empty');
                    }

                    reject(false);
                }

                html = html.replace(/<[^>]+>/gm, " . ");
                resolve(html);
            });
        }

        /**
        * В принятом тексте пытается разделить "обучениюПодробнее" на два предложения
        */
        var fixSents = function(txt){
            return new Promise(function(resolve, reject){
                if (!txt){
                    if (debug){
                        console.log('  worker::fixSents(): txt is empty');
                    }

                    reject(false);
                }

                txt = txt.replace(/([a-zа-я])(?=[A-ZА-Я])/g, "$1. ");

                resolve(txt);
            });
        }

        /**
        * Принимает текст, разбивает по переносам строк и концам предложений
        * Возвращает массив
        */
        var cleanTxtArray = function(txt){
            return new Promise(function(resolve, reject){
                if (txt == ''){
                    if (debug){
                        console.log('  worker::cleanTxtArray(): txt is empty');
                    }
                    reject(false);
                }

                var tempTxtArr = txt.split(/[\r\n]+/); // сначала разбили по переносам строк
                // теперь разбиваем внутренний текст, по концам предложений
                var txtArr = [];
                for (var i = 0; i < tempTxtArr.length; i++){
                    var iter = tempTxtArr[i];
                    iter = iter.replace(/([.?!])\s*(?=[a-zA-Zа-яА-Я])/g, "$1|").split("|");

                    // перед тем, как поместить в массив, нужно проверить дубль и содержание слов
                    if (iter.length > 0){
                        for (var k = 0; k < iter.length; k++){

                            // можно проверить на длину - чтобы отбросить сокращения типа 'см'
                            if (iter[k].length < 3){
                                continue;
                            }

                            // проверка на содержание слов
                            if ( (iter[k].match(/([а-яА-Яa-zA-Z]+)/)) === null){
                                continue;
                            }

                            // проверка на дубль
                            if (txtArr.includes(iter[k])){
                                continue;
                            }

                            txtArr.push(iter[k]);
                        }
                    }
                }
                resolve(txtArr);
            });
        }

        /**
        * Принимает массив предложений, формирует массив пачек по postLength
        */
        var fillBatch = function(txt, maxLength){
            return new Promise(function(resolve, reject){
                if (!(txt.length)){
                    if (debug){
                        console.log('  worker::fillBatch(): txt is empty');
                    }
                    reject(false);
                }

                var result = [];
                var str = '';
                for (var i = 0; i < txt.length; i++){
                    if ( (str.length) + 2 + txt[i].length <= maxLength){
                        str = str.replace(/[\.\!\? ]+$/g, '');
                        if (str !== ''){
                            str += '. ';
                        }
                        str += txt[i];
                    } else {
                        result.push(str);
                        str = txt[i];
                    }
                }
                // последний элемент сам себя не запушит
                result.push(str);
                resolve(result);
            });
        }

        /**
        * Кодирует объект в x-www-form-urlencoded
        */
        var encodeObj = function(obj){
            return new Promise(function(resolve, reject){
                var query = "";
                for (key in obj) {
                    query += encodeURIComponent(key)+"="+encodeURIComponent(obj[key])+"&";
                }
                resolve(query);
            });
        }

        /**
        * Принимает текст для отправки в Я.Спеллер
        */
        var spellerSend = function(txt){
            return new Promise(function(resolve, reject){

                if (!(txt.length)){
                    if (debug){
                        console.log('  worker::spellerSend(): txt is empty');
                    }
                    reject(false);
                }

                var data = {};
                data.text = txt;

                for (opt in spellerOpts){
                    data[opt] = spellerOpts[opt];
                }

                encodedData = encodeObj(data);

                encodedData.then(function(data){
                    var href = 'https://speller.yandex.net/services/spellservice.json/checkText';
                    var resp = false;
                    var request = new XMLHttpRequest();
                    request.open('POST', href, false);
                    request.setRequestHeader('Content-Type', 'application/x-www-form-urlencoded; charset=UTF-8');
                    request.responseType = 'json';
                    request.onload = function() {
                        if (this.status >= 200 && this.status < 400) {
                            resp = this.response;
                        } else {
                            if (debug){
                                console.log('  worker::spellerSend(): error code while sending');
                            }
                        }
                    };

                    if (debug){
                        request.onerror = function() {
                            console.log('  worker::spellerSend(): connection error');
                        };
                    }

                    request.send(data);
                    resolve(resp);
                });
            });
        }

        // worker core
        self.addEventListener('message', function(e){
            var data = e.data;

            debug = data.debug || false; // change debug-option
            spellerOpts = data.spellerOpts || false;
            var postLength = data.postLength || 3000;
            var selector = data.selector || false;
            var skipNotCyr = data.skipNotCyr || false;
            var tryRecoverSents = data.tryRecoverSents || false;
            var isHTML = data.isHTML || true; // по умолчанию пытаемся чистить html-теги

            var txt = data.text || false;
            if (!txt){
                if (debug){
                    console.log('  worker::core(): txt is empty');
                }
                return false;
            }

            var checksArr = []; // Сюда будем складировать полученные от спеллера объекты

            var prom = new Promise(function(resolve, reject){
                txt = removeMultipleBreaks(txt);
                resolve(txt);
            }).then(function(txt){
                return new Promise(function(resolve, reject){
                    if (isHTML){
                        var p = preventGluing(txt);
                        p.then(function(html){
                            resolve(html);
                        });
                    } else {
                        resolve(txt);
                    }
                });
            }).then(function(txt){
                return new Promise(function(resolve, reject){
                    if (tryRecoverSents){
                        var p = fixSents(txt);
                        p.then(function(txt){
                            resolve(txt);
                        });
                    } else {
                        resolve(txt);
                    }
                });
            }).then(function(txt){
                return new Promise(function(resolve, reject){
                    var pro = removeMultipleSpaces(txt);
                    pro.then(function(txt){
                        resolve(txt);
                    });
                });

            }).then(function(txt){
                return new Promise(function(resolve, reject){
                    var pro = cleanTxtArray(txt);
                    pro.then(function(txtArr){
                        resolve(txtArr);
                    });
                });
            }).then(function(txtArr){
                return new Promise(function(resolve, reject){
                    var pro = fillBatch(txtArr, postLength);
                    pro.then(function(txtArr){
                        resolve(txtArr);
                    });
                });
            }).then(function(txtArr){
                return new Promise(function(resolve, reject){
                    if (txtArr && txtArr.length){

                        // цикл - асинхронный. Пока пробуем сделать без await/async, через Promise.all
                        // Соберем для каждого текста промис, поместим эти промисы в массив, дождёмся выполнения каждого из них
                        // в данном случае очередность не важна
                        var promisesArr = [];

                        for (var i = 0; i < txtArr.length; i++){
                            var pr = new Promise(function(resolve, reject){
                                var tempIter = i;
                                check = spellerSend(txtArr[tempIter]);
                                check.then(function(checkData){

                                    if (checkData.length == 0){
                                        resolve(); // не вернулось ошибок
                                    }

                                    var tempArr = [];

                                    // проверить на нахождение такой ошибки в массиве
                                    for (var k = 0; k < checkData.length; k++){
                                        var pr = new Promise(function(resolve, reject){
                                            var word = checkData[k].word;

                                            var validateFailed = false; // Перед каждым типом проверки будем чекать этот флаг. Если одна валидация уже завалена, в остальных нет смысла

                                            // Здесь же проверим слово на содержание кириллицы
                                            // В зависимости от настроек, будем отбрасывать, если нет кириллицы
                                            if (skipNotCyr && !validateFailed){
                                                if ( (word.match(/([а-яА-Я])/)) === null){
                                                    // нет кириллицы, завершаем
                                                    if (debug){
                                                        console.log('В ошибке «'+word+'» нет кириллицы - не показываем её');
                                                    }
                                                    validateFailed = true;
                                                }
                                            }

                                            if (!validateFailed){
                                                var result = checksArr.filter(function(obj){
                                                    if (obj.word == word){
                                                        return true;
                                                    } else {
                                                        return false;
                                                    }
                                                });

                                                if (result.length == 0){
                                                    checksArr.push(checkData[k]);
                                                } else {
                                                    validateFailed = true;
                                                }
                                            }

                                            resolve();
                                        });
                                        tempArr.push(pr);
                                    }

                                    Promise.all(tempArr).then(function(){
                                        resolve();
                                    });
                                });
                            });
                            promisesArr.push(pr);
                        }

                        Promise.all(promisesArr).then(function(){
                            resolve();
                        });
                    } else {
                        reject(false);
                    }
                    resolve();
                });
            }).then(function(){
                var backObj = {
                    selector: selector,
                    fixes: checksArr,
                };
                postMessage(backObj);
            });
        });
    }.toString(),
    ')()' ], { type: 'application/javascript' } ) ),
    worker = new Worker(workerBlob);
    window.URL.revokeObjectURL(workerBlob); // Не понадобится боле

    /**
    * Проверяет, создан ли виджет
    */
    var checkInterfaceExist = function(){
        return new Promise(function(resolve, reject){
            var interface = document.getElementById('spellerMainWrap');
            if (interface === null){
                resolve(false);
            } else {
                resolve(true);
            }
        });
    }

    /**
    * Создаёт виджет
    */
    var createInterface = function(initialStart){
        var initialStart = initialStart || false;
        return new Promise(function(resolve, reject){
            // стили
            var widgetStyle = document.createElement('style');
            widgetStyle.innerText = `/* основная оболочка */
#spellerMainWrap{
    position: fixed;
    bottom: 0;
    right: 0;
    width: 0;
    height: 350px;
    max-height: 100vh;
    background: #fff;
    z-index: 999999999999;
}
#spellerMainWrap *{
    box-sizing: border-box;
    font-family: Arial;
    font-size: 16px;
    line-height: 20px;
}

/* кнопки */
#spellerMainWrap #speller__buttons{
    width: 25px;
    position: absolute;
    left: -25px;
    top: 0;
    opacity: 0.5;
}
#spellerMainWrap #speller__buttons:hover{
    opacity: 1;
}
#speller__buttons .speller__button{
    display: block;
    position: relative;
    filter: drop-shadow(0 0 1px green);
    text-align: center;
    font-size: 16px;
    line-height: 16px;
    color: #fff;
    text-decoration: none;
    background: #8ca983;
    padding: 5px 0 0;
}
#speller__buttons .speller__button::after{
    content: '';
    width: 0;
    height: 0;
    border-style: solid;
    border-width: 0 25px 15px 0;
    border-color: transparent #8ca983 transparent transparent;
    position: absolute;
    bottom: -15px;
    left: 0;
}
#speller__buttons .speller__button.speller-toggle{z-index: 3;}
#speller__buttons .speller__button.speller-options{z-index: 2;}
#speller__buttons .speller__button + .speller__button{padding-top: 14px;}
#speller__buttons .speller__button.speller-close{z-index: 1;}

#speller__buttons .speller__button.speller-close{background: #d27474;filter: drop-shadow(0 0 1px #8e0404);}
/*#speller__buttons .speller__button.speller-close::after{display: none;}*/
#speller__buttons .speller__button.speller-close::after{border-color: transparent #d27474 transparent transparent}
#speller__buttons .speller__button.speller-close + .speller__button{padding-top:5px;}
#speller__buttons .speller__button.speller-close{padding-bottom: 1px;}
#speller__buttons .speller__button.speller-close::before{
    content: '';
    display: block;
    height: 12px;
    margin: 3px 0 2px;
}
#speller__buttons .speller__button.speller-close::before{
    background: transparent center / contain no-repeat;
    background-image: url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNDQ4IiBoZWlnaHQ9IjUxMiIgdmlld0JveD0iMCAwIDQ0OCA1MTIiIGZpbGw9Im5vbmUiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+CjxwYXRoIGQ9Ik0zMiA0NjRDMzIgNDc2LjczIDM3LjA1NzEgNDg4LjkzOSA0Ni4wNTg5IDQ5Ny45NDFDNTUuMDYwNiA1MDYuOTQzIDY3LjI2OTYgNTEyIDgwIDUxMkgzNjhDMzgwLjczIDUxMiAzOTIuOTM5IDUwNi45NDMgNDAxLjk0MSA0OTcuOTQxQzQxMC45NDMgNDg4LjkzOSA0MTYgNDc2LjczIDQxNiA0NjRWMTI4SDMyVjQ2NFpNMzA0IDIwOEMzMDQgMjAzLjc1NyAzMDUuNjg2IDE5OS42ODcgMzA4LjY4NiAxOTYuNjg2QzMxMS42ODcgMTkzLjY4NiAzMTUuNzU3IDE5MiAzMjAgMTkyQzMyNC4yNDMgMTkyIDMyOC4zMTMgMTkzLjY4NiAzMzEuMzE0IDE5Ni42ODZDMzM0LjMxNCAxOTkuNjg3IDMzNiAyMDMuNzU3IDMzNiAyMDhWNDMyQzMzNiA0MzYuMjQzIDMzNC4zMTQgNDQwLjMxMyAzMzEuMzE0IDQ0My4zMTRDMzI4LjMxMyA0NDYuMzE0IDMyNC4yNDMgNDQ4IDMyMCA0NDhDMzE1Ljc1NyA0NDggMzExLjY4NyA0NDYuMzE0IDMwOC42ODYgNDQzLjMxNEMzMDUuNjg2IDQ0MC4zMTMgMzA0IDQzNi4yNDMgMzA0IDQzMlYyMDhaTTIwOCAyMDhDMjA4IDIwMy43NTcgMjA5LjY4NiAxOTkuNjg3IDIxMi42ODYgMTk2LjY4NkMyMTUuNjg3IDE5My42ODYgMjE5Ljc1NyAxOTIgMjI0IDE5MkMyMjguMjQzIDE5MiAyMzIuMzEzIDE5My42ODYgMjM1LjMxNCAxOTYuNjg2QzIzOC4zMTQgMTk5LjY4NyAyNDAgMjAzLjc1NyAyNDAgMjA4VjQzMkMyNDAgNDM2LjI0MyAyMzguMzE0IDQ0MC4zMTMgMjM1LjMxNCA0NDMuMzE0QzIzMi4zMTMgNDQ2LjMxNCAyMjguMjQzIDQ0OCAyMjQgNDQ4QzIxOS43NTcgNDQ4IDIxNS42ODcgNDQ2LjMxNCAyMTIuNjg2IDQ0My4zMTRDMjA5LjY4NiA0NDAuMzEzIDIwOCA0MzYuMjQzIDIwOCA0MzJWMjA4Wk0xMTIgMjA4QzExMiAyMDMuNzU3IDExMy42ODYgMTk5LjY4NyAxMTYuNjg2IDE5Ni42ODZDMTE5LjY4NyAxOTMuNjg2IDEyMy43NTcgMTkyIDEyOCAxOTJDMTMyLjI0MyAxOTIgMTM2LjMxMyAxOTMuNjg2IDEzOS4zMTQgMTk2LjY4NkMxNDIuMzE0IDE5OS42ODcgMTQ0IDIwMy43NTcgMTQ0IDIwOFY0MzJDMTQ0IDQzNi4yNDMgMTQyLjMxNCA0NDAuMzEzIDEzOS4zMTQgNDQzLjMxNEMxMzYuMzEzIDQ0Ni4zMTQgMTMyLjI0MyA0NDggMTI4IDQ0OEMxMjMuNzU3IDQ0OCAxMTkuNjg3IDQ0Ni4zMTQgMTE2LjY4NiA0NDMuMzE0QzExMy42ODYgNDQwLjMxMyAxMTIgNDM2LjI0MyAxMTIgNDMyVjIwOFpNNDMyIDMySDMxMkwzMDIuNiAxMy4zQzMwMC42MDkgOS4zMDIxNCAyOTcuNTQxIDUuOTM5MjMgMjkzLjc0MyAzLjU4OTU4QzI4OS45NDUgMS4yMzk5NCAyODUuNTY2IC0wLjAwMzIwMzQ0IDI4MS4xIC0xLjQ4ODgxZS0wN0gxNjYuOEMxNjIuMzQ0IC0wLjAxNzEzMDcgMTU3Ljk3MyAxLjIyMTM4IDE1NC4xODggMy41NzM2NEMxNTAuNDAzIDUuOTI1ODkgMTQ3LjM1OCA5LjI5Njc1IDE0NS40IDEzLjNMMTM2IDMySDE2QzExLjc1NjUgMzIgNy42ODY4NyAzMy42ODU3IDQuNjg2MjkgMzYuNjg2M0MxLjY4NTcxIDM5LjY4NjkgMCA0My43NTY1IDAgNDhMMCA4MEMwIDg0LjI0MzUgMS42ODU3MSA4OC4zMTMxIDQuNjg2MjkgOTEuMzEzN0M3LjY4Njg3IDk0LjMxNDMgMTEuNzU2NSA5NiAxNiA5Nkg0MzJDNDM2LjI0MyA5NiA0NDAuMzEzIDk0LjMxNDMgNDQzLjMxNCA5MS4zMTM3QzQ0Ni4zMTQgODguMzEzMSA0NDggODQuMjQzNSA0NDggODBWNDhDNDQ4IDQzLjc1NjUgNDQ2LjMxNCAzOS42ODY5IDQ0My4zMTQgMzYuNjg2M0M0NDAuMzEzIDMzLjY4NTcgNDM2LjI0MyAzMiA0MzIgMzJWMzJaIiBmaWxsPSJ3aGl0ZSIvPgo8L3N2Zz4K');
}

#speller__buttons .speller__button.speller-toggle::before{content: '«'; display: block;}
#spellerMainWrap.active #speller__buttons .speller__button.speller-toggle::before{content: '»';}
#speller__buttons .mistCount{
    font-size: 10px;
    line-height: 10px;
    padding: 2px;
    width: 14px;
    display: block;
    border-radius: 50%;
    position: absolute;
    z-index: 1;
    left: 50%;
    bottom: 0;
    margin-left: -7px;
    background: rgb(215,98,98);
}
#speller__buttons .mistCount.empty{background: none}
#speller__buttons .speller__button.speller-toggle{padding-bottom: 21px;}

/*#speller__buttons .speller__button.speller-options{background: #5e90ad;filter: drop-shadow(0 0 1px blue);}
#speller__buttons .speller__button.speller-options::after{border-color: transparent #5e90ad transparent transparent;}*/
#speller__buttons .speller__button.speller-options::before{
    content: '';
    display: inline-block;
    width: 13px;
    height: 16px;
    margin-top: 2px;
    background: transparent center / contain no-repeat;
    background-image: url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iOTgiIGhlaWdodD0iMTAwIiB2aWV3Qm94PSIwIDAgOTggMTAwIiBmaWxsPSJub25lIiB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciPgo8cGF0aCBmaWxsLXJ1bGU9ImV2ZW5vZGQiIGNsaXAtcnVsZT0iZXZlbm9kZCIgZD0iTTg2IDU0LjlDODYuMiA1My4zIDg2LjQgNTEuNyA4Ni40IDUwQzg2LjQgNDguMyA4Ni4zIDQ2LjcgODYgNDUuMUw5Ni42IDM2LjhDOTcuNSAzNiA5Ny44IDM0LjcgOTcuMiAzMy42TDg3LjIgMTYuM0M4Ni42IDE1LjIgODUuMyAxNC44IDg0LjEgMTUuMkw3MS43IDIwLjJDNjkuMSAxOC4yIDY2LjMgMTYuNSA2My4yIDE1LjNMNjEuMyAyLjEwMDAxQzYxLjIgMC45MDAwMDYgNjAuMSAwIDU4LjkgMEgzOC45QzM3LjcgMCAzNi42IDAuOTAwMDA2IDM2LjQgMi4xMDAwMUwzNC41IDE1LjNDMzEuNSAxNi42IDI4LjYgMTguMiAyNiAyMC4yTDEzLjYgMTUuMkMxMi41IDE0LjggMTEuMiAxNS4yIDEwLjUgMTYuM0wwLjUwMDAwNCAzMy42Qy0wLjA5OTk5NTggMzQuNyAwLjEwMDAxIDM2IDEuMTAwMDEgMzYuOEwxMS43IDQ1LjFDMTEuNSA0Ni43IDExLjQgNDguMyAxMS40IDUwQzExLjQgNTEuNyAxMS41IDUzLjMgMTEuNyA1NC45TDEuMTAwMDEgNjMuMkMwLjIwMDAxIDY0IC0wLjA5OTk5NTggNjUuMyAwLjUwMDAwNCA2Ni40TDEwLjUgODMuN0MxMS4xIDg0LjggMTIuNCA4NS4yIDEzLjYgODQuOEwyNiA3OS44QzI4LjYgODEuOCAzMS40IDgzLjUgMzQuNSA4NC43TDM2LjQgOTcuOUMzNi42IDk5LjEgMzcuNiAxMDAgMzguOSAxMDBINTguOUM2MC4xIDEwMCA2MS4yIDk5LjEgNjEuNCA5Ny45TDYzLjMgODQuN0M2Ni4zIDgzLjQgNjkuMiA4MS44IDcxLjcgNzkuOEw4NC4yIDg0LjhDODUuMyA4NS4yIDg2LjYgODQuOCA4Ny4zIDgzLjdMOTcuMyA2Ni40Qzk3LjkgNjUuMyA5Ny42IDY0IDk2LjcgNjMuMkw4NiA1NC45Wk0zMy45IDUwQzMzLjkgNTguMyA0MC42IDY1IDQ4LjkgNjVDNTcuMiA2NSA2My45IDU4LjMgNjMuOSA1MEM2My45IDQxLjcgNTcuMiAzNSA0OC45IDM1QzQwLjYgMzUgMzMuOSA0MS43IDMzLjkgNTBaIiBmaWxsPSJ3aGl0ZSIvPgo8L3N2Zz4K');
}

/* активный режим */
#spellerMainWrap.active{
    width: 350px;
}
#spellerMainWrap.active #speller__buttons{
    opacity: 1;
}
#spellerMainWrap.active #speller__buttons .speller-close{display: none}
/* дополнительная кнопка закрытия */
#speller__workWindow > .speller__button.speller-toggle{
    display: none;
    width: 25px;
    height: 25px;
    position: absolute;
    z-index: 1;
    top: 0px;
    right: 5px;
    background: #d27474;
    color: #fff;
    text-decoration: none;
    text-align: center;
    line-height: 25px;
}
#speller__workWindow > .speller__button.speller-toggle::before{
    content: '';
    display: block;
    position: absolute;
    width: 50%;
    height: 50%;
    top: 25%;
    left: 25%;
}
#spellerMainWrap .icon-chrest::before,
#spellerMainWrap .unfilterMist,
#speller__workWindow > .speller__button.speller-toggle::before{
    background: transparent center / contain no-repeat;
    background-image: url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMTQiIGhlaWdodD0iMTQiIHZpZXdCb3g9IjAgMCAxNCAxNCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPHBhdGggZD0iTTE0IDEuNDFMMTIuNTkgMEw3IDUuNTlMMS40MSAwTDAgMS40MUw1LjU5IDdMMCAxMi41OUwxLjQxIDE0TDcgOC40MUwxMi41OSAxNEwxNCAxMi41OUw4LjQxIDdMMTQgMS40MVoiIGZpbGw9IndoaXRlIi8+Cjwvc3ZnPgo=');
}
#spellerMainWrap.active #speller__workWindow > .speller__button.speller-toggle{
    display: block;
}


/* рабочий экран */
#speller__workWindow{
    padding: 25px 5px 5px 5px;
    background: #8ca983;
    position: relative;
    z-index: 4;
    height: 100%;
    width: 100%;
}
#spellerMainWrap.active #speller__workWindow{
    filter: drop-shadow(0 0 1px green);
}
#speller__workWindow::before{
    content: 'spellHelper v.1.2.4';
    font-size: 16px;
    line-height: 25px;
    font-style: italic;
    text-align: center;
    color: #fff;
    height: 25px;
    width: 100%;
    position: absolute;
    top: 0;
    left: 0;
}
/* вкладки рабочего экрана */
#speller__workWindow--inner{
    position: relative;
    width: 100%;
    height: 100%;
}
#speller__workWindow--inner > div{
    width: 100%;
    height: 100%;
    background: #fff;
    position: absolute;
    overflow: auto;
    padding: 5px;
}
#speller__workWindow--inner .activeWind{
    z-index: 9;
}

/* спойлеры */
#speller-results summary::-webkit-details-marker { display: none; }
#speller-results summary::-moz-list-bullet { list-style-type: none; }
#speller-results details{
    color: #fff;
    background: #8ca983;
    padding: 5px 15px;
    border-radius: 15px;
}
#speller-results details + details{
    margin-top: 10px;
}
#speller-results details summary{
    font-size: 16px;
    line-height: 20px;
    cursor: pointer;
}
#speller-results details .mistakeDetails{
    background: #fff;
    color: #000;
    margin: 5px 0;
}
#speller-results details .mistakeDetails p{
    margin: 0;
    display: block;
    position: relative;
    font-size: 16px;
    line-height: 20px;
    padding: 5px 45px 5px 5px;
    counter-increment: mistakes-position;
}
#speller-results details .mistakeDetails p::before{
    content: counter(mistakes-position) ") ";
}
#speller-results details .mistakeDetails p::after{
    content: '';
    display: table;
    width: 300%;
    max-width: 280px;
}
#speller-results details .mistakeDetails p:hover{
    background: antiquewhite;
}
#speller-results .mistakeDetails .ignoreMistake{
    display: block;
    position: absolute;
    width: 20px;
    height: 20px;
    top: 5px;
    right: 0;
    cursor: pointer;

    background-position: 0 0;
    background-repeat: no-repeat;
    background-image: url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMTgiIGhlaWdodD0iMTgiIHZpZXdCb3g9IjAgMCAxOCAxOCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPHBhdGggZD0iTTkgMS41QzQuODYgMS41IDEuNSA0Ljg2IDEuNSA5QzEuNSAxMy4xNCA0Ljg2IDE2LjUgOSAxNi41QzEzLjE0IDE2LjUgMTYuNSAxMy4xNCAxNi41IDlDMTYuNSA0Ljg2IDEzLjE0IDEuNSA5IDEuNVpNMyA5QzMgNS42ODUgNS42ODUgMyA5IDNDMTAuMzg3NSAzIDExLjY2MjUgMy40NzI1IDEyLjY3NSA0LjI2NzVMNC4yNjc1IDEyLjY3NUMzLjQ3MjUgMTEuNjYyNSAzIDEwLjM4NzUgMyA5Wk05IDE1QzcuNjEyNSAxNSA2LjMzNzUgMTQuNTI3NSA1LjMyNSAxMy43MzI1TDEzLjczMjUgNS4zMjVDMTQuNTI3NSA2LjMzNzUgMTUgNy42MTI1IDE1IDlDMTUgMTIuMzE1IDEyLjMxNSAxNSA5IDE1WiIgZmlsbD0iI0ZGMDAwMCIvPgo8L3N2Zz4K');
}
#speller-results .mistakeDetails .findMistake{
    display: block;
    position: absolute;
    width: 20px;
    height: 20px;
    top: 5px;
    right: 22px;
    cursor: pointer;

    background-position: 0 1px;
    background-size: 16px;
    background-repeat: no-repeat;
    background-image: url('data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCA1MTIuMDA1IDUxMi4wMDUiPjxwYXRoIGQ9Ik01MDUuNzQ5IDQ3NS41ODdsLTE0NS42LTE0NS42YzI4LjIwMy0zNC44MzcgNDUuMTg0LTc5LjEwNCA0NS4xODQtMTI3LjMxN0M0MDUuMzMzIDkwLjkyNiAzMTQuNDEuMDAzIDIwMi42NjYuMDAzUzAgOTAuOTI1IDAgMjAyLjY2OXM5MC45MjMgMjAyLjY2NyAyMDIuNjY3IDIwMi42NjdjNDguMjEzIDAgOTIuNDgtMTYuOTgxIDEyNy4zMTctNDUuMTg0bDE0NS42IDE0NS42YzQuMTYgNC4xNiA5LjYyMSA2LjI1MSAxNS4wODMgNi4yNTFzMTAuOTIzLTIuMDkxIDE1LjA4My02LjI1MWM4LjM0MS04LjM0MSA4LjM0MS0yMS44MjQtLjAwMS0zMC4xNjV6TTIwMi42NjcgMzYyLjY2OWMtODguMjM1IDAtMTYwLTcxLjc2NS0xNjAtMTYwczcxLjc2NS0xNjAgMTYwLTE2MCAxNjAgNzEuNzY1IDE2MCAxNjAtNzEuNzY2IDE2MC0xNjAgMTYweiIvPjwvc3ZnPg==');

    filter: invert(38%) sepia(67%) saturate(384%) hue-rotate(60deg) brightness(94%) contrast(95%);
}

/* шаблон настроек */
#spellerMainWrap .spellerOptionSet{
    border: 1px solid silver;
    padding: 5px 5px 5px;
    position: relative;
}
#spellerMainWrap .spellerOptionSet + .spellerOptionSet{
    margin-top: 5px;
}
#spellerMainWrap .spellerOptionSet.filteringSet{
    padding: 30px 5px 5px;
}

/* кнопки опций */
#spellerMainWrap .optionset__buttons{
    padding-top: 5px;
    margin-top: 5px;
    position: relative;
}
#spellerMainWrap .optionset__buttons::before{
    content: '';
    position: absolute;
    width: 100%;
    height: 1px;
    background: silver;
    top: 0;
    left: 0;
}
#spellerMainWrap .optionset__button{
    display: inline-block;
    border: 1px solid #8ca983;
    border-color: #8ca983 #6c8265 #6c8265 #8ca983;
    background: #8ca983;
    color: #fff;
    border-radius: 3px;
    padding: 0 5px;
    font-size: 16px;
    line-height: 20px;
    cursor: pointer;
}

/* Секция фильтра ошибок */
#spellerMainWrap .spellerOptionSet.filteringSet::before{
    content: 'Игнорируемые ошибки:';
    font-size: 16px;
    line-height: 25px;
    text-align: cen-ter;
    padding: 0 5px;
    color: #fff;
    background: #8ca983;
    height: 25px;
    width: 100%;
    box-sizing: border-box;
    display: block;
    position: absolute;
    top: 0;
    left: 0;
}
#spellerMainWrap .filteringSet .optionset__buttons{
    margin-top: 0;
}
#spellerMainWrap .filteredMistakes .mistake{
    display: inline-block;
    margin-bottom: 5px;
    margin-right: 5px;
    background: antiquewhite;
    padding: 1px 24px 1px 5px;
    font-size: 16px;
    line-height: 20px;
    cursor: default;
    position: relative;
    color: #846236;
}
#spellerMainWrap .filteredMistakes .mistake .unfilterMist{
    cursor: pointer;
    width: 10px;
    height: 10px;
    position: absolute;
    top: 6px;
    right: 5px;
    filter: invert(32%) sepia(9%) saturate(3284%) hue-rotate(355deg) brightness(60%) contrast(50%);
}

/* Секция настроек домена */
#spellerMainWrap input,
#spellerMainWrap label,
#spellerMainWrap textarea{
    margin: 0 auto;
    font-size: 16px;
    min-height: 20px;
    line-height: 20px;
    vertical-align: middle;
    font-weight: 400;
}
#spellerMainWrap input{
    width: 16px;
    -webkit-appearance: checkbox;
}
#spellerMainWrap textarea{
    width: 100%;
    padding: 3px 5px 5px;
    max-width: 100%;
    min-width: 100%;
}
#spellerMainWrap label{
    display: inline-block;
}
#spellerMainWrap .opts__row + .opts__row{
    margin-top: 5px;
}

/* Копирайт */
#spellerMainWrap .speller-copyright, #spellerMainWrap .speller-copyright:hover{
    position: absolute;
    bottom: 0;
    width: calc(100% - 10px);
    text-align: center;
    font-size: 10px;
    color: #888888;
    text-decoration: none;
    line-height: 12px;
    font-weight: 400;
}
#spellerMainWrap .speller-copyright:hover{
    color: #000;
    text-decoration: underline;
}

/* Подсветка предложений */
.spellerMark:hover{
    position: relative;
}
.spellerMark:hover::after{
    content: var(--mistake-suggestion);
    display: inline;
    width: max-content;
    box-sizing: border-box;
    position: absolute;
    top: calc((1em + 12px) * -1);
    line-height: 1em;
    left: 50%;
    transform: translate(-50%);
    text-align: center;
    border: 1px solid #ff8800;
    padding: 5px;
    border-radius: 5px;
    background: linear-gradient(to bottom, #ffbd72, #e67b00, #e67b00, #bb4a00);
    color: #fff;
    text-shadow: 0px 1px 1px black;
}
#speller-results details .mistakeDetails p:hover .findMistake{
    width: auto;
    padding-left: 20px;
    font-size: 12px;
}
#speller-results details .mistakeDetails p:hover .findMistake::after{
    content: 'Показать';    
}
/*.spellerMark{
    background: rgb(255 190 69 / 76%);
}*/
@keyframes speller__visualizeMistake{
    8% {box-shadow: 0 0 0px 75px #ff0} /*rgb(255 190 69 / 76%)*/
}
.speller__mistakeVisualized{
    animation: speller__visualizeMistake 3000ms 1 ease-out alternate;
}`;
            document.getElementsByTagName('head')[0].appendChild(widgetStyle);
            // сам виджет
            var widget = document.createElement('div');
            widget.id = 'spellerMainWrap';
            widget.innerHTML = `
    <!-- рабочее окно. Содержит в себе слои с табами -->
    <div id="speller__workWindow">
        <div id="speller__workWindow--inner">
            <div id="speller-options">
                <div class="spellerOptionSet filteringSet">
                    <div class="filteredMistakes">
                    </div>
                    <div class="optionset__buttons">
                        <span class="optionset__button spellerClearFilter">Удалить все</span>
                    </div>
                </div>
                <div class="spellerOptionSet domainSet">
                    <div class="domainOpts__wrap">
                        <div class="opts__row">
                            <input type="checkbox" id="domainAutostart" /> <label for="domainAutostart">Автозапуск на домене</label>
                        </div>
                        <div class="opts__row">
                            <label for="ignorePathContains">Игнорировать пути:</label>
                            <textarea id="ignorePathContains" placeholder="Задавать список в формате: '/admin/','/user/'"></textarea>
                        </div>
                        <div class="opts__row">
                            <input type="checkbox" id="markMistakes" /> <label for="markMistakes">Подсвечивать ошибки</label>
                        </div>
                    </div>
                    <div class="optionset__buttons">
                        <span class="optionset__button save__domainOpts">Сохранить</span>
                    </div>
                </div>
                <a href="https://github.com/HDDen/spellHelper" target="_blank" class="speller-copyright nointercept">github.com/HDDen/spellHelper</a>
            </div>
            <div id="speller-results">
            </div>
        </div>
        <a href="javascript:void(0);" class="speller__button speller-toggle" title="Свернуть" data-constTitle="yes"></a>
    </div>

    <!-- хранит кнопки -->
    <div id="speller__buttons">
        <a href="javascript:void(0);" class="speller__button speller-toggle" title="Открыть"><span class="mistCount empty">-</span></a>
        <a href="javascript:void(0);" class="speller__button speller-options" title="Настройки"></a>
        <a href="javascript:void(0);" class="speller__button speller-close" title="Выключить"></a>
    </div>`;

            // класс для детекта запуска без запросов к спеллеру
            if (initialStart){
                widget.classList.add('onlyInterface');
            }

            document.body.appendChild(widget);

            // назначаем обработчики событий
            interfaceBtns();

            resolve();
        });
    }

    /**
    * Отправляет разметку с ошибками в виджет
    */
    var pushMistakes = function(markup){
        return new Promise(function(resolve, reject){
            var postMarkup = function(){
                var recipient = document.querySelectorAll('#spellerMainWrap #speller-results');
                if (recipient.length){
                    recipient[0].innerHTML += markup;
                } else {
                    if (debug){
                        console.log('pushMistakes(): Виджет не существует');
                    }
                    reject(false);
                }
            }

            var interface = checkInterfaceExist();
            interface.then(function(isExists){
                if (! (isExists) ){
                    // если виджета не существует, создаем
                    var createWidget = createInterface();
                    createWidget.then(function(){
                        postMarkup();
                        resolve();
                    });
                } else {
                    postMarkup();
                    resolve();
                }
            });
        });

    }

    /**
    * Получает список игнорируемых ошибок из LocalStorage (массив)
    */
    var getIgnoredList = function(){
        return new Promise(function(resolve, reject){
            var ignoredMistakes = localStorage.getItem('speller_ignoredMistakes');
            if (ignoredMistakes === null){
                ignoredMistakes = [];
            } else {
                ignoredMistakes = JSON.parse(ignoredMistakes);
            }
            resolve(ignoredMistakes);
        });
    }

    /**
    * Добавляет ошибку к списку игнорируемых в LocalStorage
    */
    var addIgnoredMistake = function(txt){
        var existingMistakes = getIgnoredList();
        existingMistakes.then(function(existingArr){
            if ( !(existingArr.includes(txt)) ){
                existingArr.push(txt);
                existingArr = JSON.stringify(existingArr);
                localStorage.setItem('speller_ignoredMistakes', existingArr);
            }
        });
    }

    /**
    * Удаляет ошибку из списка игнорируемых
    */
    var unignoreMistake = function(el){
        // удаляем ошибку из списка игнорируемых, затем обновим интерфейс настроек
        var getIgnored = getIgnoredList(); // промис
        getIgnored.then(function(list){
            if (list.length){
                var mistake = el.parentNode.getAttribute('title');
                var index = list.indexOf(mistake);
                if (index !== -1){
                    var newArr = list.filter(function(val){
                        return (val !== mistake);
                    });

                    // новый массив ошибок, без текущей, создан. Надо его сохранить
                    var updateMistakes = fullRewriteIgnoredList(newArr); // вернёт промис
                    updateMistakes.then(function(){
                        // перерисуем ошибки в интерфейсе настроек
                        loadMistakesFilterConf();
                    });
                }
            } else {
                // список ошибок и так пуст, нечего чистить
            }

            // надо бы перезапросить парсинг
            // очищаем список найденных ошибок и запускам проверку снова
            var clearResults = clearSpellerResults();
            clearResults.then(function(){
                // сначала удаляем предыдущее выделение ошибок
                var p = remMistakesMark();
                p.then(function(){
                    mainF();
                });
                
            });
        });
    }

    /**
    * Полностью переписывает список игнорируемых ошибок
    * Можно использовать для обнуления, передав пустой массив
    * возвращает промис с переменной true
    */
    var fullRewriteIgnoredList = function(arr){
        return new Promise(function(resolve, reject){
            arr = JSON.stringify(arr);
            localStorage.setItem('speller_ignoredMistakes', arr);
            resolve(true);
        });
    }

    /**
    * Обработчик игнорирования ошибок
    * Помечает ошибку как игнорируемую + удаляет её из виджета
    */
    var setMistakeIgnore = function(el){
        var mistake = el.getAttribute('data-mist');
        if (mistake){
            addIgnoredMistake(mistake); // запоминаем игнор
            remOneMist(mistake); // снимаем выделение
        }

        // фиксируем корневой родитель
        var mistakeCoreParent = el.parentNode.parentNode.parentNode; // <details>

        // удаляем заигноренную ошибку
        var parent = el.parentNode;
        if (parent.tagName == 'P'){
            parent.parentNode.removeChild(parent); // удаляем ошибку из виджета
            updateMistakesCounter(); // обновляем счётчик
        }

        // нужно обновить summary
        var summary = mistakeCoreParent.querySelectorAll('summary')[0];
        var selector = summary.getAttribute('data-selector');
        if (selector){
            var mistakesLeft = mistakeCoreParent.querySelectorAll('p').length;
            summary.textContent = selector + ': '+mistakesLeft+' ошибок';

            // для красоты свернём details
            if (!mistakesLeft){
                mistakeCoreParent.removeAttribute('open');
            }
        }
    }

    /**
     * Скроллим к ошибке
     */
    var showMistake = function(el){
        var mistake = el.getAttribute('data-mist');
        if (debug){
            console.log('Скроллим к ошибке '+mistake);
        }
        if (mistake){

            // получим все элементы с этой ошибкой и просто выведем в консоль
            var mistakes = document.querySelectorAll(`.spellerMark[data-mistake="${mistake}"]`);

            if (debug){
                console.log('Элементы с ошибками',mistakes, 'селектор ' + `.spellerMark[data-mistake="${mistake}"]`);
            }

            // пока по-простому - скролл только к первой ошибке
            if (mistakes.length){
                // будем запоминать в window, к какой ошибке (и какой её экземпляр) мы скроллили
                // если это была та же ошибка, скроллить к следующему экземпляру
                
                // назначаем умолчание
                if (window.spellerScrolledMistake === undefined){
                    window.spellerScrolledMistake = {
                        mistakeText: '',
                        mistakeIndex: -1,
                    };
                }

                // поиск, куда скроллить
                // в цикле ищем видимого на странице кандидата
                var scrolledTo = window.spellerScrolledMistake.mistakeIndex;
                var newScroll = scrolledTo;

                if (window.spellerScrolledMistake.mistakeText == mistake){
                    // скроллим к той же ошибке, но нужно понять, двигаемся дальше по nodeList или начинаем с 0
                    
                    if ((scrolledTo + 1) < mistakes.length){
                        newScroll = scrolledTo + 1;
                        
                        // нужно двигаться дальше по выборке, если очередной элемент невидим
                        while (mistakes[newScroll].offsetWidth < 1 && mistakes[newScroll].offsetHeight < 1){
                            if (newScroll < mistakes.length){
                                newScroll++;
                            } else {
                                newScroll = 0;
                            }
                        }
                    } else {
                        newScroll = 0;
                    }

                    if (debug){
                        console.log('Скролл к элементу', mistakes[newScroll], 'позиция скролла', "\u{2191}" + mistakes[newScroll].offsetHeight + ' x ' + mistakes[newScroll].offsetWidth + "\u{2192}");
                    }

                } else {
                    scrolledTo = window.spellerScrolledMistake.mistakeIndex = -1; // для детекта повторного перехода к тому же элементу
                    newScroll = 0;
                }


                
                // добавим визуализации. Сейчас снимем класс, затем - добавим, если скроллим к той же самой ошибке
                var mistakeVisualized = document.querySelectorAll('.speller__mistakeVisualized');
                if (mistakeVisualized.length){
                    for (var i = 0; i < mistakeVisualized.length; i++){
                        mistakeVisualized[i].classList.remove('speller__mistakeVisualized');
                    }
                }

                // скролл
                if (mistakes[newScroll].offsetWidth > 0 && mistakes[newScroll].offsetHeight > 0){
                    var scrollPosition = mistakes[newScroll].getBoundingClientRect().top + window.scrollY - (window.innerHeight / 2);
                    window.scrollTo(0, scrollPosition);
                    // пробую визуализировать всё, посмотрю по ощущениям
                    //mistakes[newScroll].classList.add('speller__mistakeVisualized');
                } else {
                    window.scrollTo(0, 0);
                    console.log('Похоже, элемент за пределами экрана');
                }

                // продолжение визуализации. Если мы повторно скроллим к той же ошибке, нужо обозначить её присутствие на странице
                if ( (scrolledTo == newScroll) && (mistakes.length < 2) ){ 
                    mistakes[newScroll].classList.add('speller__mistakeVisualized');
                }

                // запоминаем позицию скролла
                window.spellerScrolledMistake.mistakeIndex = newScroll;
                window.spellerScrolledMistake.mistakeText = mistake;
            }
        } else if (debug){
            console.log('Ошибка не обнаружена!');
        }
    }

    /**
    * Очищает результаты поиска ошибок
    * Полезно, если будете перезапрашивать парсинг
    * Возвращает промис
    */
    var clearSpellerResults = function(){
        return new Promise(function(resolve, reject){
            if (!resultsWind){
                resultsWind = document.getElementById('speller-results');
            }

            if (resultsWind !== null){
                resultsWind.innerHTML = '';
            }

            resolve(true);
        });
    }

    /**
    * Открытие виджета
    */
    var openWidget = function(){
        if (!widget){
            widget = document.getElementById('spellerMainWrap');
        }

        if (widget !== null){
            if ( !(widget.classList.contains('active')) ){
                widget.classList.add('active');
                // меняем метку, но в зависимости от data-constTitle
                var changeMark = document.querySelectorAll('.speller__button.speller-toggle');
                if (changeMark.length){
                    for (var i = 0; i < changeMark.length; i++){
                        if (changeMark[i].getAttribute('data-constTitle') !== 'yes'){
                            changeMark[i].title = 'Свернуть';
                        }
                    }
                }
            }
        }
    }

    /**
    * Смена состояния (открытие/сворачивание) виджета
    */
    var toggleWidget = function(el){
        if (!widget){
            widget = document.getElementById('spellerMainWrap');
        }

        if (widget !== null){
            if (widget.classList.contains('active')){
                widget.classList.remove('active');
                // меняем метку, но в зависимости от data-constTitle
                var changeMark = document.querySelectorAll('.speller__button.speller-toggle');
                if (changeMark.length){
                    for (var i = 0; i < changeMark.length; i++){
                        if (changeMark[i].getAttribute('data-constTitle') !== 'yes'){
                            changeMark[i].title = 'Открыть';
                        }
                    }
                }

            } else {
                // открываем виджет
                openWidget();
                // если был создан виджет, но данных в нём нет, при открытии стартанём парсинг ошибок
                if (widget.classList.contains('onlyInterface')){
                    if (debug){
                        console.log('Виджет пуст, т.к. автопроверка не включена для этого домена. Запрашиваем проверку ошибок вручную...');
                    }
                    widget.classList.remove('onlyInterface');

                    // врезка
                    // если нужно подгрузить сначала сторонний скрипт
                    if (markMistakes){
                        var startAfterLoad = loadRes({
                            src: 'https://cdn.jsdelivr.net/npm/mark.js@8.11.1/dist/mark.min.js', 
                            type: 'script', 
                            id: 'markjs'
                        });
                        startAfterLoad.then(function(result){
                            if (result){
                                var result = mainF();
                            }
                        });
                    } else {
                        var result = mainF();
                    }
                }

                // делает окно с результатами активным при запуске, если только не открывали через кнопку настроек
                if ( !(el.classList.contains('speller-options')) ){
                    setResultsWindowActive();
                }

                // смещение виджета в конец body, чтобы не перекрывался всякими чатами
                if (widget.nextSibling !== null){
                    raiseWidget();
                }
            }
        }
    }

    /**
    * Смещение виджета в конец body, чтобы не перекрывался всякими чатами
    */
    var raiseWidget = function(){
        if (!widget){
            widget = document.getElementById('spellerMainWrap'); // попробуем кэшировать для следующих вызовов по замыканию
        }
        if (widget !== null){
            if (widget.nextSibling !== null){
                widget.parentNode.append(widget);
            }
        }
    }

    /**
    * Удаление виджета со страницы
    */
    var removeWidget = function(){
        if (!widget){
            widget = document.getElementById('spellerMainWrap');
        }

        if (widget !== null){
            widget.parentNode.removeChild(widget);

            // также удалим ошибки
            remMistakesMark();
        }
    }

    /**
    * Делает активным окно результатов
    */
    var setResultsWindowActive = function(){
        // сначала убрать класс у всех остальных
        var currentActive = widget.querySelectorAll('#speller__workWindow--inner .activeWind');
        if (currentActive.length){
            for (var i = 0; i < currentActive.length; i++){
                currentActive[i].classList.remove('activeWind');
            }
        }

        // затем назначить активным окно результатов
        if (!resultsWind){
            resultsWind = document.getElementById('speller-results');
        }
        if (resultsWind !== null){
            resultsWind.classList.add('activeWind');
        }
    }

    /**
    * Открытие/закрытие настроек
    */
    var toggleSettingsWindow = function(el){
        if (!widget){
            widget = document.getElementById('spellerMainWrap');
        }

        if (!settingsWind){
            settingsWind = document.getElementById('speller-options');
        }

        if (settingsWind !== null){
            if (settingsWind.classList.contains('activeWind')){
                settingsWind.classList.remove('activeWind');
            } else {
                // убрать класс у всех остальных
                var currentActive = widget.querySelectorAll('#speller__workWindow--inner .activeWind');
                if (currentActive.length){
                    for (var i = 0; i < currentActive.length; i++){
                        currentActive[i].classList.remove('activeWind');
                    }
                }

                // назначить активным окно настроек
                settingsWind.classList.add('activeWind');
            }
        }

        // Если виджет был закрыт, нужно открыть его
        if ( !(widget.classList.contains('active')) ){
            toggleWidget(el);
        }

        // также нужно загружать сохранённые настройки
        loadStoredConfig();
    }

    /**
    * Загружает настройки из localStorage в интерфейс виджета
    */
    var loadStoredConfig = function(){
        // фильтр ошибок
        loadMistakesFilterConf();
        // доменные настройки
        loadDomainConfig();
    }

    /**
    * Грузим доменные настройки в память и в экран настроек
    */
    var loadDomainConfig = function(){
        // автозапуск
        if (!widget){
            widget = document.getElementById('spellerMainWrap');
        }
        if (widget !== null){
            if ( (localStorage.getItem('speller_domainAutostart')) == 'true' ){
                document.getElementById('domainAutostart').checked = true;
            } else {
                document.getElementById('domainAutostart').checked = false;
            }
        }
        loadAutostartInMemory();

        // фильтр путей
        var pathBlacklist = localStorage.getItem('speller_pathsIgnore');
        if (widget !== null){
            if ( (pathBlacklist == '') || (pathBlacklist == null) ){
                // если пуст, просто очистить textfield
                document.getElementById('ignorePathContains').value = '';
            } else {
                // парсим json, превращаем в строку
                pathBlacklistArr = JSON.parse(pathBlacklist);

                pathBlacklist = '';
                if ( (Array.isArray(pathBlacklistArr)) && (pathBlacklistArr.length > 0)){
                    for (var i = 0; i < pathBlacklistArr.length; i++){
                        if (pathBlacklist !== ''){
                            pathBlacklist += ', ';
                        }
                        var str = "'"+pathBlacklistArr[i]+"'";
                        pathBlacklist += str;
                    }
                }

                document.getElementById('ignorePathContains').value = pathBlacklist;
            }
        }
        loadPathBlacklistInMemory();

        // отмечалка на домене
        var mustMarkMistakes = localStorage.getItem('speller_markMistakes');
        if (widget !== null){
            if (mustMarkMistakes == 'false'){
                markMistakes = false;
                document.getElementById('markMistakes').checked = false;
                remMistakesMark(); // удаляем отмеченные ошибки
            } else if (mustMarkMistakes == 'true'){
                markMistakes = true;
                document.getElementById('markMistakes').checked = true;
            }
        }
    }

    /**
    * Грузит настройки автозапуска в память
    * Вернёт промис
    */
    var loadAutostartInMemory = function(){
        return new Promise(function(resolve, reject){
            var autostart = localStorage.getItem('speller_domainAutostart');
            if (autostart == ''){
                if ((window.location.host) in autoDomains){
                    delete autoDomains[window.location.host]; // если в autoDomains есть текущий домен, удалим
                }
            } else if (autostart == 'true'){
                if ( !((window.location.host) in autoDomains) ){
                    autoDomains[window.location.host] = ''; // если в autoDomains нет текущего домена, добавим
                }
            }
            resolve();
        });
    }

    /**
    * Грузит фильтр путей в память
    * Вернёт промис
    */
    var loadPathBlacklistInMemory = function(){
        return new Promise(function(resolve, reject){
            var pathBlacklist = localStorage.getItem('speller_pathsIgnore');

            if ((window.location.host) in autoDomains){
                if ( (pathBlacklist != null) && (pathBlacklist != '') ){
                    pathBlacklist = JSON.parse(pathBlacklist);
                } else {
                    pathBlacklist = [];
                }

                // если значение объекта по имени домена - пустая строка, формируем объект
                if (autoDomains[window.location.host] == ''){
                    autoDomains[window.location.host] = {'forbidden': pathBlacklist};
                }
            }
            resolve();
        });
    }

    /**
    * Грузим опцию выделения ошибок в память
    */
    var loadMarkMistakesInMemory = function(){
        var willMark = localStorage.getItem('speller_markMistakes');
        
        if ( (willMark != null) && (willMark != '') ){
            if (willMark == 'true'){
                markMistakes = true;
            } else {
                markMistakes = false;
                // удаляем отмеченные ошибки
                remMistakesMark();
            }
        }
    }

    /**
    * Сохраняем доменные настройки в хранилище и в памяти
    */
    var setDomainConfig = function(){
        // автозапуск на домене
        var autostart = '';
        if (document.getElementById('domainAutostart').checked){
            autostart = 'true';
        }
        localStorage.setItem('speller_domainAutostart', autostart); // фиксируем в хранилище

        // игнорировать, если путь включает в себя
        var pathBlacklist = document.getElementById('ignorePathContains').value || '';
        pathBlacklist = pathBlacklist.replace(' ', ''); // сразу удалим пробелы - пригодится и в проверке
        if (pathBlacklist != ''){
            // подготовить строку к хранению
            pathBlacklist = pathBlacklist.slice(1, (pathBlacklist.length - 1)); // удалим начальный и конечный '
            pathBlacklist = pathBlacklist.split("','"); // превращаем в массив;
            pathBlacklist = JSON.stringify(pathBlacklist);
        }
        localStorage.setItem('speller_pathsIgnore', pathBlacklist);

        // выделять найденные ошибки
        var markMistakesVal = 'false';
        if (document.getElementById('markMistakes').checked){
            markMistakesVal = 'true';
        }
        localStorage.setItem('speller_markMistakes', markMistakesVal);
        if (markMistakesVal === 'false'){
            remMistakesMark(); // снимем выделение с найденных
        }

        // теперь грузим в память
        var temp = loadAutostartInMemory();
        temp.then(function(){
            loadPathBlacklistInMemory();
        });
    }

    /**
    * Грузит фильтруемые ошибки в экран настроек
    */
    var loadMistakesFilterConf = function(){
        // должны считать список ошибок из localStorage, подготовить разметку, отправить её в секцию настроек
        var getIgnoredMistakes = getIgnoredList(); // Промис, вернёт Array
        getIgnoredMistakes.then(function(list){

            // здесь хранится разметка с ошибками / отсутствием оных
            var mistakesParent = document.querySelectorAll('#speller-options .filteredMistakes')[0];
            var mistakesMarkup = '';

            if (list.length){
                for (var i = 0; i < list.length; i++){
                    var oneMistakeMarkup = `<div class="mistake" title="${list[i]}">${list[i]}<span class="unfilterMist" title="Удалить"></span></div>`;
                    mistakesMarkup += oneMistakeMarkup;
                }

                // теперь пишем пушим разметку в интерфейс
                mistakesParent.innerHTML = mistakesMarkup;
            } else {
                // игнорируемых нет, очистить имеющийся вывод и вывести сообщение об этом ( todo )
                if (debug){
                    console.log('игнорируемых ошибок нет');
                }
                mistakesParent.innerHTML = mistakesMarkup;
            }
        });
    }

    /**
    * Кнопки управления состоянием виджета
    */
    var widgetControls = function(el){
        if (el.classList.contains('speller-toggle')){
            // открытие/закрытие виджета
            toggleWidget(el);
        } else if (el.classList.contains('speller-close')){
            // удаление виджета со страницы
            removeWidget();
        } else if (el.classList.contains('speller-options')){
            // открыть настройки
            toggleSettingsWindow(el);
        }
    }

    /**
    * Кнопки управления виджетом
    * Основная функция для определения действий по нажатиям кнопок
    */
    var interfaceBtns = function(){
        if (!widget){
            widget = document.getElementById('spellerMainWrap');
        }

        if (widget !== null){
            widget.addEventListener('click', function(e){
                // отсюда будем рулить кнопками
                e.stopPropagation();
                if (e.target.tagName == 'A'){
                    if (! (e.target.classList.contains('nointercept'))){
                        e.preventDefault();
                    }
                }

                if (e.target.classList.contains('speller__button')){
                    // передаем управление обработчику контролов
                    widgetControls(e.target);
                } else if (e.target.classList.contains('ignoreMistake')){
                    // игнорирование этой ошибки
                    setMistakeIgnore(e.target);
                } else if (e.target.classList.contains('findMistake')){
                    // поиск ошибки на странице
                    showMistake(e.target);
                } else if (e.target.classList.contains('unfilterMist')){
                    // удаление ошибки из списка игнорируемых
                    unignoreMistake(e.target);
                } else if (e.target.classList.contains('spellerClearFilter')){
                    // полная очистка списка игнорируемых слов
                    clearSpellerResults().then(function(){
                        return fullRewriteIgnoredList([]);
                    }).then(function(){
                        loadStoredConfig();
                        // сначала удаление предыдущего выделения ошибок перед перезапуском парсинга
                        var p = remMistakesMark();
                        p.then(function(){
                            mainF();
                        });
                    });
                } else if (e.target.classList.contains('mistCount')){
                    // щелчок по индикатору ошибок - нужно назначить активным окно с результатами
                    // + развернуть виджет, если был закрыт
                    setResultsWindowActive();
                    openWidget();
                } else if (e.target.classList.contains('save__domainOpts')){
                    // нужно созранить доменные настройки
                    // Это автозапуск и игнор путей
                    setDomainConfig();
                }

                raiseWidget(); // поднимаем над живочатом
            })
        }
    }

    /**
    * Обновляет счётчик ошибок - пересчитывает вложенные details
    */
    var updateMistakesCounter = function(){
        var mistakesCount = document.querySelectorAll('#speller-results .mistakeDetails > p').length;
        var mistakesCounter = document.querySelectorAll('#spellerMainWrap #speller__buttons .mistCount')[0];
        if (mistakesCount > 0){
            mistakesCounter.classList.remove('empty');
        } else {
            mistakesCounter.classList.add('empty');
        }
        mistakesCounter.innerText = mistakesCount;
    }

    /**
    * Обновляет счетчик только в том случае, если он еще не был обновлён ни разу
    */
    var initMistakesCounter = function(){
        if(document.querySelectorAll('#spellerMainWrap #speller__buttons .mistCount')[0].textContent == '-'){
            updateMistakesCounter();
        }
    }

    /**
    * Грузит необходимый сторонний ресурс
    */
    var loadRes = function(ext){
        return new Promise(function(resolve, reject){
            var src = ext.src || false;
            var type = ext.type || false;
            var id = ext.id || 'id'+(Math.random().toString(36).substring(2, 6) + Math.random().toString(36).substring(2, 6));
            var done = false;

            // сначала проверка уже загруженного
            if (document.querySelectorAll('#'+id).length > 0){
                if (debug){
                    console.log('loadRes(): Ресурс с ID '+id+' уже загружен');
                }
                resolve(true);
            }

            if (src && type){

                if (type == 'script'){
                    var obj = document.createElement('script');
                    obj.id = id;
                } else if (type == 'css'){
                    var obj = document.createElement('link');
                    obj.id = id;
                    obj.rel  = 'stylesheet';
                    obj.type = 'text/css';
                    obj.media = 'all';
                } else {
                    if (debug){
                        console.log('loadRes(): Тип внешнего ресурса '+src+' не установлен, отбой...');
                    }
                    reject(false);
                }

                function getPath(obj, type){
                    if (type == 'script'){
                        obj.src = src;
                    } else if (type == 'css'){
                        obj.href = src;
                    }
                    return obj;
                }
                obj = getPath(obj, type); // setting src or href

                function handleLoad() {
                    if (!done) {
                        done = true;
                        if (debug){
                            console.log('loadRes(): Сторонний скрипт загружен!');
                        }
                        resolve(true);
                    }
                }
                function handleReadyStateChange() {
                    var state;
                    if (debug){
                        console.log('loadRes(): Сторонний скрипт загружается!');
                    }

                    if (!done) {
                        state = obj.readyState;
                        if (state === "complete") {
                            if (debug){
                                console.log('loadRes(): state = complete, запускаем handleLoad()');
                            }
                            handleLoad();
                        }
                    }
                }
                function handleError() {
                    if (!done) {
                        done = true;
                        if (debug){
                            console.log('loadRes(): error, сторонний скрипт не загрузился.');
                        }
                        reject(false);
                    }
                }

                obj.onload = handleLoad;
                obj.onreadystatechange = handleReadyStateChange;
                obj.onerror = handleError;

                document.head.appendChild(obj);

            } else {
                reject(false); // закрываем
            }
        });
    }

    /**
    * Выделяет ошибки на странице
    */
    var doMarkMistakes = function(mistakes, variants){

        if (debug){
            console.log('Выделяем следующие ошибки', mistakes);
            console.log('Варианты для подсветки', variants);
        }

        var selector = 'body'; // ограничение выделения

        var context = document.querySelector(selector);
        var instance = new Mark(context);
        instance.mark(mistakes, {
            separateWordSearch: false,
            accuracy: {
                "value": "exactly",
                "limiters": [",", ".", "!", "?", ":", ";", "(", ")"]
            },
            caseSensitive: true,
            className: 'spellerMark',
            each: function(el){
                // пропишем текст ошибки в data-атрибут
                el.setAttribute('data-mistake', el.textContent);
                // добавляем подсказку к элементу
                if (Object.keys(variants).length){
                    var suggestion = variants[el.textContent];

                    if (debug){
                        console.log('suggestion', suggestion);
                    }
                    
                    var style = '';
                    if (el.hasAttribute('style')){
                        style = el.getAttribute('style');
                    }
                    style = '--mistake-suggestion:"' + suggestion + '";' + style;
                    
                    el.setAttribute('style', style);
                }
            }
        });

        window['speller_marks'] = instance;
    }

    /**
    * Удаляет выделение ошибок
    * Возвращает промис
    */
    var remMistakesMark = function(){
        return new Promise(function(resolve, reject){
            console.log('Удаление ошибок');
            if (typeof window['speller_marks'] !== "undefined"){
                window['speller_marks'].unmark();
                resolve(true);
            } else {
                resolve(false);
            }
        });
    }

    /**
    * Удаляет одну конкретную ошибку
    */
    var remOneMist = function(mistake){
        if (mistake != ''){
            if (debug){
                console.log('Удаляем выделение с «'+mistake+'»');
            }

            var mists = document.querySelectorAll('mark');
            if (mists.length > 0){
                for (var i = 0; i < mists.length; i++){
                    if (mists[i].textContent == mistake){
                        mists[i].outerHTML = mistake;
                    }
                }
            }
        }
    }

    /**
    * Обработчик ответа воркера
    */
    worker.addEventListener('message', function(e){

        // после получения сырого сообщения от воркера мы должны определить, есть ли что выводить нам в интерфейс.
        // для этого нужно проверить:
        // 1) пустоту массива ошибок
        // 2) код каждой ошибки. Если не 1 - считать её отсутствующей
        // 3) проверять слово, помеченное как ошибку, на её присутствие в массиве игнорируемых. Если игнорим - считаем ошибку отсутствующей

        // Будем создавать массив, который должен заполняться ошибками в случае соблюдения условий.
        // В конце проверять его. Если не пуст - строить интерфейс или пушить в имеющийся

        // Если пришли какие-то ошибки
        if (e.data.fixes.length > 0){
            // Пустой массив для наполнения прошедшими проверку ошибками
            //var resultArr = [];
            window['spellerResultArr'] = []; // делаем доступной из window, чтобы обращаться к массиву из разных частей скрипта

            // проверить каждую ошибку на код. Допустим только код 1.
            var tempArr = []; // массив промисов
            for (var i = 0; i < e.data.fixes.length; i++){
                var p = new Promise(function(resolve, reject){
                    var item = e.data.fixes[i];
                    if (item.code !== 1){
                        resolve(); // закрываем промис, не добавляя ошибку
                    } else {
                        var ignoreMistakes = getIgnoredList();
                        ignoreMistakes.then(function(ignoredList){
                            // получили список игнорируемых ошибок (Array)
                            // теперь нужно проверить ошибку на присутствие в стоп-листе
                            if (ignoredList.length > 0){

                                // игнорируем ошибку
                                if (! (ignoredList.includes(item.word))){
                                    window['spellerResultArr'].push({word: item.word, 's': item.s[0]});
                                }
                                resolve();
                            } else {
                                window['spellerResultArr'].push({word: item.word, 's': item.s[0]});
                                resolve();
                            }
                        });
                    }
                });
                tempArr.push(p);
            }

            // если после фильтрации остались ошибки
            if (tempArr.length){
                Promise.all(tempArr).then(function(){
                    if (window['spellerResultArr'].length){

                        // управление полученными результатами
                        // пушим в интерфейс
                        // сначала проверяем его наличие, если нет - создаём. Затем добавляем элементы.
                        var isInterfaceExists = checkInterfaceExist();
                        isInterfaceExists.then(function(isExists){
                            return new Promise(function(resolve, reject){
                                if (!isExists){
                                    var interface = createInterface();
                                    interface.then(function(){
                                        resolve(true);
                                    });
                                } else {
                                    resolve(true);
                                }
                            });

                        }).then(function(){
                            // формируем разметку для каждой ошибки, засылаем её в интерфейс

                            // шаблон режется на две части
                            var detailStart = `<details id="det${(Math.random()*1010|0)}" open>
                                <summary data-selector="${e.data.selector}">${e.data.selector}: ${window['spellerResultArr'].length} ошибок</summary>
                                <div class="mistakeDetails">`;
                            var detailsEnd = `</div>
                                </details>`;
                            var mistakes = '';

                            var tempArr = [];
                            for (var i = 0; i < window['spellerResultArr'].length; i++){
                                var tempFunc = function(obj, index){
                                    return new Promise(function(resolve, reject){
                                        var str = `<p>"${window['spellerResultArr'][i].word}" -> "${window['spellerResultArr'][i].s}"<span class="findMistake" data-mist="${window['spellerResultArr'][i].word}" title="Показать на странице"></span><span class="ignoreMistake" data-mist="${window['spellerResultArr'][i].word}" title="Добавить в игнорируемые"></span></p>`;
                                        mistakes += str;
                                        resolve(str);
                                    });
                                }
                                tempArr.push(tempFunc(window['spellerResultArr'][i], i));
                            }

                            Promise.all(tempArr).then(function(){
                                // Сформировали разметку для всех ошибок, отправляем её
                                pushMistakes(detailStart+mistakes+detailsEnd).then(function(){
                                    // и затем обновляем счётчик ошибок
                                    updateMistakesCounter();
                                    // выделяем ошибки на самой странице
                                    if (markMistakes){
                                        var mistakesToMark = [];
                                        var variantsForHighting = new Object;
                                        for (var oi = 0; oi < window['spellerResultArr'].length; oi++){
                                            // пушим слово в массив для отметки
                                            mistakesToMark.push(window['spellerResultArr'][oi].word);
                                            // доп. массив для подсвечивания при наведении на ошибку
                                            if (highlightSuggestions){
                                                variantsForHighting[`${window['spellerResultArr'][oi].word}`] = window['spellerResultArr'][oi].s;
                                            }
                                        }
                                        doMarkMistakes(mistakesToMark, variantsForHighting);
                                    }
                                });
                            });
                        });
                    } else {
                        // длина результатов после фильтрации = 0. Иногда нужно этот ноль тоже пушить в счётчик.
                        updateMistakesCounter();
                    }
                });
            } else {
                // после фильтрации ошибок не осталось
                initMistakesCounter();
            }
        } else {
            // нужно апдейтить результат даже нулём, если в счётчике изначально прочерк (когда нет автозапуска)
            initMistakesCounter();
        }
    });

    /**
    * Основная функция.
    * Сначала получаем текст из селектора, затем отдаём его в воркер
    */
    var mainF = function(){

        if (debug){
            console.log('запустились');
        }

        // запустили парсинг - убираем класс "onlyInterface"
        if (!widget){
            widget = document.getElementById('spellerMainWrap');
        }

        if (widget !== null){
            widget.classList.remove('onlyInterface');
        }

        // обходим объект walkSelectors
        // каждый селектор с (атрибутом или без) упаковываем в объект, затем передаём в extractTxt
        for (var key in walkSelectors){

            var obj = {selector: key, extractHTML: extractHTML}; // указываем селектор
            if (walkSelectors[key] !== ''){
                obj.attribute = walkSelectors[key]; // указываем, что извлекать нужно атрибут, а не текст
            }

            var helper = function(key, obj){ // сохраняем key
                var prom = new Promise(function(resolve, reject){
                    var result = extractTxt(obj);
                    resolve(result);
                }).then(function(result){
                    // Отправка в воркер
                    // Постим месседж в воркер:
                    var toWorker = {
                        text: result,
                        postLength: postLength,
                        selector: key,
                        debug: debug,
                        spellerOpts: spellerOptions,
                        skipNotCyr: skipNotCyr,
                        tryRecoverSents: tryRecoverSents,
                        isHTML: extractHTML,
                    };
                    worker.postMessage(toWorker);
                });
            }
            helper(key, obj);
        }

        return true;
    }

    // Стартуем!
    var domain = window.location.host;
    // фильтр запуска виджета
    // быстро и грязно, у нас в итоге 3 разных проверки на автозапуск. Нужно исправить.
    if (excludeList.length){
        for (var i = 0; i < excludeList.length; i++){
            if (window.location.href.indexOf(excludeList[i]) > -1){
                if (debug){
                    console.log('запрещено по домену '+ excludeList[i] +' в excludeList');
                }
                return false;
            }
        }
    }

    // Создаем интерфейс, затем, если есть автозапуск для домена, стартуем mainF()
    var initialStart = true; // если запуск без последующего парсинга, ставим класс главному родителю
    var start = createInterface(initialStart);
    start.then(function(){
        return new Promise(function(resolve, reject){
            // грузим настройки
            loadStoredConfig();
            resolve();
        });
    }).then(function(){
        // автозапуск по домену
        if (domain in autoDomains){
            // проверка на запрет запуска по фильтру путей
            var domainParams = autoDomains[domain];
            var allowed = true;
            // глобальный фильтр путей
            if (globalPathBlacklist.length > 0){
                for (var i = 0; i < globalPathBlacklist.length; i++){
                    if (allowed){
                        if ( (window.location.href.indexOf(globalPathBlacklist[i]) + 1) ){
                            allowed = false;
                        }
                    }
                }
            }

            if (debug && !(allowed)){
                console.log('запрещено по глобальному фильтру путей');
            }

            // теперь более узкая проверка, по блеклисту для конкретного домена
            if ( ('forbidden' in domainParams) && allowed ){
                for (var i = 0; i < domainParams.forbidden.length; i++){
                    if (allowed){
                        if ( (window.location.href.indexOf(domainParams.forbidden[i]) + 1) ){ // тоже оставим .href, на всякий случай
                            allowed = false;
                        }
                    }
                }

                if (debug && !(allowed)){
                    console.log('запрещено по фильтру путей домена');
                }
            }

            if (allowed){
                // если нужно подгрузить сначала сторонний скрипт
                if (markMistakes){
                    var startAfterLoad = loadRes({
                        src: 'https://cdn.jsdelivr.net/npm/mark.js@8.11.1/dist/mark.min.js', 
                        type: 'script', 
                        id: 'markjs'
                    });
                    startAfterLoad.then(function(result){
                        if (result){
                            mainF();
                        }
                    });
                } else {
                    mainF();
                }
            }
        } else {
            //if (debug){
            //  console.log('автозапуск не состоялся');
            //  console.log('domain', domain);
            //  console.log('autoDomains', autoDomains);
            //}
        }
    });

}"loading"!=document.readyState?n():document.addEventListener("DOMContentLoaded",function(){n()})}();
