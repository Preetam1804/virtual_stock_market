/* Ask glibc for the POSIX declarations (usleep, termios, select) even when
   compiled with a strict -std=c11 instead of the default gnu* dialect. */
#ifndef _WIN32
#define _DEFAULT_SOURCE
#endif

#include <stdio.h>
#include <string.h>
#include <stdlib.h>
#include <time.h>
#ifdef _WIN32
#include <conio.h>
#include <windows.h>
#else
#include <unistd.h>
#include <termios.h>
#include <fcntl.h>
#include <sys/select.h>
#endif

/* Number of listed tickers. */
#define STOCK_COUNT 5
/* Money is 64-bit: a 32-bit int overflowed and corrupted real accounts. */
#define MONEY_FMT "%lld"

/* Widest line we will read out of portfolio.txt. */
#define USER_FIELD 49
#define NAME_FIELD 99
#define HOLDINGS_FIELD 255

typedef struct {
    char username[50];
    char fullname[50];
    char password[50];
    long long balance;
} user;


typedef struct
{
    char symbol[50];
    char name[50];
    int price;
} stocks;

typedef struct {
    char username[100];
    long long balance;
    char stocks[256];
} portfolio;

int login_check(char input_username[], char input_password[], user* logged_in_user);
void sign_up(void);
void show_portfolio(char username[]);
void buy_stocks(char username[], user* current_user, stocks* stock);
void update_portfolio(char username[], user* current_user, int quantity, long long stock_price, stocks* stock, int stock_select);
void update_balance(char username[], user* current_user);
void sell_stocks(char username[], user* current_user, stocks* stock);
void fix_empty_portfolios(void);
void show_stock_trend(const char *stock_name);

int kbhit(void);
int read_int(const char *prompt);
void clear_input_buffer(void);

void set_nonblocking(int state) {
#ifndef _WIN32
    struct termios ttystate;
    tcgetattr(STDIN_FILENO, &ttystate);

    if (state == 1) {
        ttystate.c_lflag &= ~ICANON;
        ttystate.c_lflag &= ~ECHO;
        ttystate.c_cc[VMIN] = 1;
    } else {
        ttystate.c_lflag |= ICANON;
        ttystate.c_lflag |= ECHO;
    }
    tcsetattr(STDIN_FILENO, TCSANOW, &ttystate);
#endif
}

/* conio.h's getch() is Windows-only; this is the portable equivalent. */
static int getch_portable(void) {
#ifdef _WIN32
    return _getch();
#else
    struct termios old_state, raw_state;
    tcgetattr(STDIN_FILENO, &old_state);
    raw_state = old_state;
    raw_state.c_lflag &= ~(ICANON | ECHO);
    tcsetattr(STDIN_FILENO, TCSANOW, &raw_state);
    int ch = getchar();
    tcsetattr(STDIN_FILENO, TCSANOW, &old_state);
    return ch;
#endif
}

void clear_input_buffer(void) {
    int ch;
    while ((ch = getchar()) != '\n' && ch != EOF) { }
}

/* Reads a whole number, re-prompting safely instead of spinning forever. */
int read_int(const char *prompt) {
    int value;
    printf("%s", prompt);
    fflush(stdout);
    if (scanf("%d", &value) != 1) {
        clear_input_buffer();
        return -1;
    }
    clear_input_buffer();
    return value;
}

int kbhit(void) {
#ifdef _WIN32
    return _kbhit();
#else
    struct timeval tv = { 0L, 0L };
    fd_set fds;
    FD_ZERO(&fds);
    FD_SET(0, &fds);
    return select(1, &fds, NULL, NULL, &tv);
#endif
}

void display_real_time_stock_graph_single(stocks* stock, int index) {
    if (index < 0) {
        printf("Invalid stock index.\n");
        return;
    }

    char symbol[50];
    strcpy(symbol, stock[index].symbol);

    int base_price = stock[index].price;
    int price = base_price;

    const int MAX_POINTS = 60;
    const int GRAPH_HEIGHT = 10;

    int price_history[MAX_POINTS];
    int filled_points = 0;
    int history_index = 0;

    srand(time(NULL) ^ clock());
    for (int i = 0; i < MAX_POINTS; i++) {
        price_history[i] = base_price + (rand() % 201 - 100);
    }

    set_nonblocking(1);

    while (1) {
#ifdef _WIN32
        system("cls");
#else
        system("clear");
#endif

        printf("\nReal-Time Stock Price for %s\n", symbol);
        printf("----------------------------------------------\n");

        int change = (rand() % 1001) - 500;
        price += change;
        if (price < 1000) price = 1001;

        price_history[history_index] = price;
        history_index = (history_index + 1) % MAX_POINTS;
        if (filled_points < MAX_POINTS) filled_points++;

        // Calculate min and max prices
        int min_price = price_history[0], max_price = price_history[0];
        for (int i = 1; i < filled_points; i++) {
            int idx = (history_index + i) % MAX_POINTS;
            if (price_history[idx] < min_price) min_price = price_history[idx];
            if (price_history[idx] > max_price) max_price = price_history[idx];
        }

        int range = max_price - min_price;
        if (range == 0) range = 1;

        // Draw Y axis from top to bottom
        for (int y = GRAPH_HEIGHT; y >= 0; y--) {
            int label_price = min_price + (range * y) / GRAPH_HEIGHT;
            printf("%5d |", label_price);  // Y-axis label and line

            for (int i = 0; i < filled_points; i++) {
                int idx = (history_index + i) % MAX_POINTS;
                int scaled = ((price_history[idx] - min_price) * GRAPH_HEIGHT) / range;

                if (scaled == y) {
    printf("*");
} else if (y == 0) {
    printf("_");  // x-axis
} else if (y < scaled) {
    printf("|");  // stem goes downward from star
} else {
    printf(" ");
}
            }
            printf("\n");
        }

        
        printf("      +");
       
        printf("\n");
        printf("\t\tTIME \n");
        printf("Current Price: %d\n", price);
        printf("Press 'q' to quit and return to menu...\n");

#ifdef _WIN32
        Sleep(1500);
#else
        usleep(1500000);
#endif

        if (kbhit()) {
            char c = getchar();
            if (c == 'q' || c == 'Q') break;
        }
    }

    set_nonblocking(0);
}


int main(void) {
    int choice;
    user current_user;
    int logged_in = 0;
    char username[50], password[50];
    srand((unsigned)time(NULL)); // Seed random number generator ONCE at program start

    fix_empty_portfolios(); // every account gets a portfolio row, blanks become "None"

    while (1) {
        printf("\n========== VIRTUAL STOCK MARKET ==========\n");
        printf("1. Login\n");
        printf("2. Sign Up\n");
        printf("3. Exit\n");
        choice = read_int("Enter your choice: ");

        if (choice == 1) {
            int apl=(rand()%600)+1200;
            int gogl=(rand()%600)+1800;
            int tsla=(rand()%600)+3000;
            int msft=(rand()%600)+4150;
            int amzn=(rand()%600)+1000;
            stocks stock[]={{"APL","Apple Inc.",apl},{"GOGL","Google",gogl},{"TSLA","Tesla",tsla},{"MSFT","Microsoft",msft},{"AMZN","Amazon",amzn}};

            printf("Enter username: ");
            if (scanf("%49s", username) != 1) {
                clear_input_buffer();
                continue;
            }
            clear_input_buffer();

            printf("Enter password: ");
            fflush(stdout);
            char ch;
            int i=0;
            while(i < 49 && (ch=getch_portable())!=13 && ch!=10 && ch!=EOF){
                if (ch == 8 && i > 0) { // handle backspace
                    i--;
                    printf("\b \b");
                    continue;
                }
                password[i]=ch;
                i++;
                printf("*");
            }
            password[i]='\0';
            printf("\n");

            if (login_check(username, password, &current_user)) {
                printf("Login successful! Welcome, %s\n", current_user.fullname);
                logged_in = 1;
                int user_choice;
                while (logged_in) {
                    printf("\n--- USER MENU ---\n");
                    printf("1. Show Portfolio\n");
                    printf("2. Buy Stocks\n");
                    printf("3. Sell Stocks\n");
                    printf("4. Deposit Balance\n");
                    printf("5. View Real-Time Stock Graph\n");
                    printf("6. Show Stock Trend\n");
                    printf("7. Logout\n");
                    user_choice = read_int("Enter your choice: ");
                    switch (user_choice) {
                        case 1:
                            show_portfolio(username);
                            break;
                        case 2:
                            buy_stocks(username, &current_user, stock);
                            break;
                        case 3:
                            sell_stocks(username, &current_user, stock);
                            break;
                        case 4:
                            update_balance(username, &current_user);
                            break;
                        case 5: {
                            printf("\nSelect stock to view graph:\n");
                            for (int i = 0; i < STOCK_COUNT; i++) {
                                printf("%d. %s (%s)\n", i+1, stock[i].name, stock[i].symbol);
                            }
                            int graph_choice = read_int("Enter choice: ");
                            if (graph_choice >= 1 && graph_choice <= STOCK_COUNT) {
                                display_real_time_stock_graph_single(stock, graph_choice-1);
                            } else {
                                printf("Invalid choice.\n");
                            }
                            break;
                        }
                        case 6:
                            printf("Select stock to view trend:\n");
                            for (int i = 0; i < STOCK_COUNT; i++) {
                                printf("%d. %s (%s)\n", i+1, stock[i].name, stock[i].symbol);
                            }
                            int trend_choice = read_int("Enter choice: ");
                            if (trend_choice >= 1 && trend_choice <= STOCK_COUNT) {
                                show_stock_trend(stock[trend_choice-1].symbol);
                            } else {
                                printf("Invalid choice.\n");
                            }
                            break;
                        case 7:
                            logged_in = 0;
                            printf("Logged out.\n");
                            break;
                        default:
                            printf("Invalid choice.\n");
                    }
                }
            } else {
                printf("Login failed. Invalid username or password.\n");
            }
        } else if (choice == 2) {
            sign_up();
        } else if (choice == 3) {
            printf("Exiting...\n");
            break;
        } else {
            printf("Invalid choice. Try again.\n");
        }
    }
    return 0;
}

void sign_up(void) {
    user new_user, temp;
    int exists;
    FILE* fp;

    do {
        exists = 0;
        printf("Enter username: ");
        if (scanf("%49s", new_user.username) != 1) {
            clear_input_buffer();
            return;
        }
        clear_input_buffer();

        fp = fopen("users.txt", "r");
        if (fp != NULL) {
            while (fscanf(fp, "%49s %49s %49s " MONEY_FMT, temp.username, temp.fullname, temp.password, &temp.balance) == 4) {
                if (strcmp(temp.username, new_user.username) == 0) {
                    exists = 1;
                    printf("Username already exists. Try another one.\n");
                    break;
                }
            }
            fclose(fp);
        }
    } while (exists);

    printf("Enter full name: ");
    if (scanf(" %49[^\n]", new_user.fullname) != 1) {
        clear_input_buffer();
        return;
    }
    /* users.txt is whitespace-delimited and every reader splits on spaces,
       so fold them into underscores — the web client does the same. */
    for (char *c = new_user.fullname; *c != '\0'; c++) {
        if (*c == ' ' || *c == '\t') *c = '_';
    }

    printf("Enter password (max 49 characters, no spaces): ");
    if (scanf("%49s", new_user.password) != 1) {
        clear_input_buffer();
        return;
    }
    clear_input_buffer();
    if (new_user.username[0] == '\0' || new_user.password[0] == '\0') {
        printf("Username and password cannot be empty.\n");
        return;
    }
    new_user.balance = 10000;

    fp = fopen("users.txt", "a");
    if (fp == NULL) {
        printf("Error opening users file for writing.\n");
        return;
    }
    fprintf(fp, "%s %s %s " MONEY_FMT "\n", new_user.username, new_user.fullname, new_user.password, new_user.balance);
    fclose(fp);

    FILE* port = fopen("portfolio.txt", "a");
    if (port == NULL) {
        printf("Error opening portfolio file for writing.\n");
        return;
    }
    portfolio p = {"", 10000, "None"};
    snprintf(p.username, sizeof(p.username), "%s", new_user.username);
    fprintf(port, "%s " MONEY_FMT " %s\n", p.username, p.balance, p.stocks);
    fclose(port);

    printf("User registered successfully!\n");
}


int login_check(char input_username[], char input_password[], user* logged_in_user) {
    user temp;
    FILE* fp = fopen("users.txt", "r");
    if (fp == NULL) {
        printf("Error opening users file.\n");
        return 0;
    }

    while (fscanf(fp, "%49s %49s %49s " MONEY_FMT, temp.username, temp.fullname, temp.password, &temp.balance) == 4) {
        if (strcmp(temp.username, input_username) == 0 && strcmp(temp.password, input_password) == 0) {
            *logged_in_user = temp;
            fclose(fp);
            return 1;
        }
    }

    fclose(fp);
    return 0;
}



void show_portfolio(char username[]) {
    FILE* fp = fopen("portfolio.txt", "r");
    portfolio temp;
    int found=0;

    if (fp == NULL) {
        printf("Error opening portfolio file.\n");
        return;
    }

    while (fscanf(fp, "%99s " MONEY_FMT " %255s", temp.username, &temp.balance, temp.stocks) == 3) {
        if (strcmp(temp.username, username) == 0) {
            printf("\n---- Portfolio ----\n\n");
            printf("Username : %s\n", temp.username);
            printf("Balance  : " MONEY_FMT "\n", temp.balance);
            printf("Stocks   : %s\n\n", temp.stocks);
            found=1;
            break;
        }
    }

    if (found==0) {
        printf("Portfolio not found.\n");
    }

    fclose(fp);
}

void buy_stocks(char username[], user* current_user, stocks* stock) {
    printf("\n%-5s %-15s %-15s %12s\n", "S.No", "Symbol", "Company", "Price");
    printf("-------------------------------------------------------------\n");
    for (int i = 0; i < STOCK_COUNT; i++) {
        printf("%-5d %-15s %-15s %12lld\n", i + 1, stock[i].symbol, stock[i].name, (long long)stock[i].price);
    }

    int stock_select = read_int("\nSelect your stock (enter serial number): ");
    if (stock_select < 1 || stock_select > STOCK_COUNT) {
        printf("Invalid stock selection.\n");
        return;
    }

    int quantity = read_int("Enter quantity: ");
    if (quantity <= 0) {
        printf("Quantity must be greater than zero.\n");
        return;
    }

    long long stock_price = (long long)quantity * stock[stock_select - 1].price;
    printf("\nStock      : %s\n", stock[stock_select - 1].symbol);
    printf("Quantity   : %d\n", quantity);
    printf("Total cost : " MONEY_FMT "\n", stock_price);

    update_portfolio(username, current_user, quantity, stock_price, stock, stock_select);
}

void update_portfolio(char username[], user* current_user, int quantity, long long stock_price, stocks* stock, int stock_select) {
    if (quantity <= 0) {
        printf("Quantity must be greater than zero.\n");
        return;
    }
    if (current_user->balance < stock_price) {
        printf("Insufficient balance.\n");
        return;
    }

    user temp_user;
    user users[100];
    int user_count = 0;
    long long new_balance = 0;
    FILE* fp = fopen("users.txt", "r");
    if (fp == NULL) {
        printf("Error opening users file.\n");
        return;
    }
    while (fscanf(fp, "%49s %49s %49s " MONEY_FMT, temp_user.username, temp_user.fullname, temp_user.password, &temp_user.balance) == 4) {
        if (strcmp(temp_user.username, username) == 0) {
            temp_user.balance -= stock_price;
            new_balance = temp_user.balance;
            *current_user = temp_user;
        }
        users[user_count++] = temp_user;
    }
    fclose(fp);

    fp = fopen("users.txt", "w");
    for (int i = 0; i < user_count; i++) {
        fprintf(fp, "%s %s %s " MONEY_FMT "\n", users[i].username, users[i].fullname, users[i].password, users[i].balance);
    }
    fclose(fp);

    FILE* pf = fopen("portfolio.txt", "r");
    portfolio portfolios[100];
    int port_count = 0;
    portfolio temp_port;
    if (pf == NULL) {
        printf("Error opening portfolio file.\n");
        return;
    }
    while (fscanf(pf, "%99s " MONEY_FMT " %255s", temp_port.username, &temp_port.balance, temp_port.stocks) == 3) {
        portfolios[port_count++] = temp_port;
    }
    fclose(pf);

    int row = -1;
    for (int i = 0; i < port_count; i++) {
        if (strcmp(portfolios[i].username, username) == 0) { row = i; break; }
    }
    if (row == -1 && port_count < 100) {
        /* Account with no portfolio row yet — create one so the shares land somewhere. */
        row = port_count++;
        snprintf(portfolios[row].username, sizeof(portfolios[row].username), "%s", username);
        portfolios[row].balance = new_balance;
        snprintf(portfolios[row].stocks, sizeof(portfolios[row].stocks), "None");
    }
    if (row == -1) {
        printf("Portfolio table is full.\n");
        return;
    }

    portfolios[row].balance = new_balance;

    char updated_stocks[512] = "";
    int found = 0;
    if (strcmp(portfolios[row].stocks, "None") != 0) {
        char holdings[256];
        snprintf(holdings, sizeof(holdings), "%s", portfolios[row].stocks);
        char* token = strtok(holdings, ",");
        while (token != NULL) {
            char sym[50];
            int quant = 0;
            if (sscanf(token, "%49[^:]:%d", sym, &quant) == 2) {
                if (strcmp(sym, stock[stock_select - 1].symbol) == 0) {
                    quant += quantity;
                    found = 1;
                }
                char entry[64];
                snprintf(entry, sizeof(entry), "%s:%d,", sym, quant);
                if (strlen(updated_stocks) + strlen(entry) < sizeof(updated_stocks)) {
                    strcat(updated_stocks, entry);
                }
            }
            token = strtok(NULL, ",");
        }
    }
    if (!found) {
        char entry[64];
        snprintf(entry, sizeof(entry), "%s:%d,", stock[stock_select - 1].symbol, quantity);
        if (strlen(updated_stocks) + strlen(entry) < sizeof(updated_stocks)) {
            strcat(updated_stocks, entry);
        }
    }

    int len = (int)strlen(updated_stocks);
    if (len > 0 && updated_stocks[len - 1] == ',') updated_stocks[len - 1] = '\0';
    snprintf(portfolios[row].stocks, sizeof(portfolios[row].stocks), "%s",
             len > 0 ? updated_stocks : "None");

    pf = fopen("portfolio.txt", "w");
    for (int i = 0; i < port_count; i++) {
        fprintf(pf, "%s " MONEY_FMT " %s\n", portfolios[i].username, portfolios[i].balance, portfolios[i].stocks);
    }
    fclose(pf);

    printf("Order successful!\n");
}

void update_balance(char username[], user* current_user) {
    long long dep = read_int("Enter the amount you want to deposit: ");

    if (dep <= 0) {
        printf("Deposit must be greater than zero.\n");
        return;
    }
    if (dep > 50000) {
        printf("Maximum deposit limit is 50000.\n");
        return;
    }

    user users[100];
    user temp_user;
    int user_count = 0;
    FILE* fp = fopen("users.txt", "r");
    if (!fp) {
        printf("Error opening users file.\n");
        return;
    }

    while (fscanf(fp, "%49s %49s %49s " MONEY_FMT, temp_user.username, temp_user.fullname, temp_user.password, &temp_user.balance) == 4) {
        if (strcmp(temp_user.username, username) == 0) {
            temp_user.balance += dep;
            *current_user = temp_user;
        }
        users[user_count++] = temp_user;
    }

    fclose(fp);
    fp = fopen("users.txt", "w");
    for (int i = 0; i < user_count; i++) {
        fprintf(fp, "%s %s %s " MONEY_FMT "\n", users[i].username, users[i].fullname, users[i].password, users[i].balance);
    }
    fclose(fp);

    portfolio temp_port;
    portfolio temp_port_struct[100];
    int port_count = 0;
    FILE* port = fopen("portfolio.txt", "r");
    if (!port) {
        printf("Error opening portfolio file.\n");
        return;
    }
    while (fscanf(port, "%99s " MONEY_FMT " %255s", temp_port.username, &temp_port.balance, temp_port.stocks) == 3) {
        if (strcmp(temp_port.username, username) == 0) {
            temp_port.balance += dep;
        }
        temp_port_struct[port_count++] = temp_port;
    }
    fclose(port);

    port = fopen("portfolio.txt", "w");
    for (int i = 0; i < port_count; i++) {
        fprintf(port, "%s " MONEY_FMT " %s\n", temp_port_struct[i].username, temp_port_struct[i].balance, temp_port_struct[i].stocks);
    }
    fclose(port);

    printf("Deposited " MONEY_FMT ". New balance: " MONEY_FMT "\n", dep, current_user->balance);
}

void sell_stocks(char username[], user* current_user, stocks* stock) {
    FILE* pf = fopen("portfolio.txt", "r");
    portfolio temp_port;
    portfolio temp_port_struct[100];
    int port_count = 0;
    int found = 0;
    int quantity;
    user temp_user;
    user users[100];
    int user_count = 0;
    long long sale_amount = 0;
    char sold_symbol[50] = "";

    if (pf == NULL) {
        printf("Error opening portfolio file.\n");
        return;
    }
    while (fscanf(pf, "%99s " MONEY_FMT " %255s", temp_port.username, &temp_port.balance, temp_port.stocks) == 3) {
        if (strcmp(temp_port.username, username) == 0) {
            found = 1;
            printf("Available stocks:\n");
            if (strcmp(temp_port.stocks, "None") == 0) {
                printf("  (none)\n");
                fclose(pf);
                return;
            }
            char listed[256];
            snprintf(listed, sizeof(listed), "%s", temp_port.stocks);
            char* token = strtok(listed, ",");
            while (token != NULL) {
                char sym[50];
                int quant = 0;
                if (sscanf(token, "%49[^:]:%d", sym, &quant) == 2) {
                    printf("  %s: %d\n", sym, quant);
                }
                token = strtok(NULL, ",");
            }

            printf("Enter the stock symbol you want to sell: ");
            char stock_symbol[50];
            if (scanf("%49s", stock_symbol) != 1) {
                clear_input_buffer();
                fclose(pf);
                return;
            }
            clear_input_buffer();

            quantity = read_int("Enter the quantity you want to sell: ");
            if (quantity <= 0) {
                printf("Quantity must be greater than zero.\n");
                fclose(pf);
                return;
            }

            int stock_index = -1;
            for (int i = 0; i < STOCK_COUNT; i++) {
                if (strcmp(stock[i].symbol, stock_symbol) == 0) {
                    stock_index = i;
                    break;
                }
            }
            if (stock_index == -1) {
                printf("Invalid stock symbol.\n");
                fclose(pf);
                return;
            }
            snprintf(sold_symbol, sizeof(sold_symbol), "%s", stock_symbol);

            char updated_stocks[512] = "";
            int stock_found = 0;
            char stocks_copy[256];
            snprintf(stocks_copy, sizeof(stocks_copy), "%s", temp_port.stocks);
            token = strtok(stocks_copy, ",");
            while (token != NULL) {
                char sym[50];
                int quant = 0;
                if (sscanf(token, "%49[^:]:%d", sym, &quant) == 2) {
                    if (strcmp(sym, stock_symbol) == 0) {
                        stock_found = 1;
                        if (quant < quantity) {
                            printf("Not enough stocks to sell.\n");
                            fclose(pf);
                            return;
                        }
                        quant -= quantity;
                        if (quant > 0) {
                            char entry[64];
                            snprintf(entry, sizeof(entry), "%s:%d,", sym, quant);
                            if (strlen(updated_stocks) + strlen(entry) < sizeof(updated_stocks)) {
                                strcat(updated_stocks, entry);
                            }
                        }
                    } else {
                        char entry[64];
                        snprintf(entry, sizeof(entry), "%s:%d,", sym, quant);
                        if (strlen(updated_stocks) + strlen(entry) < sizeof(updated_stocks)) {
                            strcat(updated_stocks, entry);
                        }
                    }
                }
                token = strtok(NULL, ",");
            }
            if (!stock_found) {
                printf("You do not own this stock.\n");
                fclose(pf);
                return;
            }

            int len = (int)strlen(updated_stocks);
            if (len > 0 && updated_stocks[len - 1] == ',') updated_stocks[len - 1] = '\0';
            snprintf(temp_port.stocks, sizeof(temp_port.stocks), "%s",
                     len > 0 ? updated_stocks : "None");

            sale_amount = (long long)quantity * stock[stock_index].price;
            temp_port.balance += sale_amount;
            temp_port_struct[port_count++] = temp_port;
            break;
        } else {
            temp_port_struct[port_count++] = temp_port;
        }
    }
    fclose(pf);

    if (!found) {
        printf("Portfolio not found.\n");
        return;
    }

    long long new_balance = 0;
    for (int i = 0; i < port_count; i++) {
        if (strcmp(temp_port_struct[i].username, username) == 0) {
            new_balance = temp_port_struct[i].balance;
            break;
        }
    }

    pf = fopen("portfolio.txt", "w");
    for (int i = 0; i < port_count; i++) {
        fprintf(pf, "%s " MONEY_FMT " %s\n", temp_port_struct[i].username, temp_port_struct[i].balance, temp_port_struct[i].stocks);
    }
    fclose(pf);

    FILE* uf = fopen("users.txt", "r");
    if (uf == NULL) {
        printf("Error opening users file.\n");
        return;
    }
    while (fscanf(uf, "%49s %49s %49s " MONEY_FMT, temp_user.username, temp_user.fullname, temp_user.password, &temp_user.balance) == 4) {
        if (strcmp(temp_user.username, username) == 0) {
            temp_user.balance = new_balance; // sync balance
            *current_user = temp_user;
        }
        users[user_count++] = temp_user;
    }
    fclose(uf);

    uf = fopen("users.txt", "w");
    for (int i = 0; i < user_count; i++) {
        fprintf(uf, "%s %s %s " MONEY_FMT "\n", users[i].username, users[i].fullname, users[i].password, users[i].balance);
    }
    fclose(uf);

    printf("Sold %d x %s for " MONEY_FMT ".\n", quantity, sold_symbol, sale_amount);
}

void fix_empty_portfolios(void) {
    FILE* pf = fopen("portfolio.txt", "r");
    portfolio temp_port;
    portfolio temp_port_struct[100];
    int port_count = 0;
    if (pf == NULL) {
        printf("Error opening portfolio file.\n");
        return;
    }
    while (fscanf(pf, "%99s " MONEY_FMT " %255[^\n]", temp_port.username, &temp_port.balance, temp_port.stocks) == 3) {
        /* Trim a trailing CR so files saved on Windows parse the same way. */
        size_t len = strlen(temp_port.stocks);
        while (len > 0 && (temp_port.stocks[len - 1] == '\r' || temp_port.stocks[len - 1] == ' ')) {
            temp_port.stocks[--len] = '\0';
        }
        if (len == 0) {
            snprintf(temp_port.stocks, sizeof(temp_port.stocks), "None");
        }
        temp_port_struct[port_count++] = temp_port;
    }
    fclose(pf);
    pf = fopen("portfolio.txt", "w");
    for (int i = 0; i < port_count; i++) {
        fprintf(pf, "%s " MONEY_FMT " %s\n", temp_port_struct[i].username, temp_port_struct[i].balance, temp_port_struct[i].stocks);
    }
    fclose(pf);
}

#define MAX_DAYS 100
#define MAX_LINE 100
#define MAX_DATE_LEN 20
#define MAX_PRICES_PER_DAY 100

typedef struct {
    char date[MAX_DATE_LEN];
    int day_only;
    float prices[MAX_PRICES_PER_DAY];
    int price_count;
    float min_price;
    float max_price;
} DayTrend;

void show_stock_trend(const char *stock_name) {
    char filename[100];
    snprintf(filename, sizeof(filename), "stock_trend_of_%s.txt", stock_name);
    FILE *file = fopen(filename, "r");
    if (!file) {
        printf("Error: Could not open file %s\n", filename);
        return;
    }

    DayTrend trends[MAX_DAYS];
    int day_count = 0;
    char line[MAX_LINE];

    // Read and group prices by date
    while (fgets(line, sizeof(line), file)) {
        float price;
        char date[MAX_DATE_LEN];
        if (sscanf(line, "%f %s", &price, date) != 2) continue;

        int found = 0;
        for (int i = 0; i < day_count; i++) {
            if (strcmp(trends[i].date, date) == 0) {
                trends[i].prices[trends[i].price_count++] = price;
                found = 1;
                break;
            }
        }

        if (!found) {
            strcpy(trends[day_count].date, date);
            int day;
            sscanf(date, "%d-%*d-%*d", &day); 
            trends[day_count].day_only = day;
            trends[day_count].prices[0] = price;
            trends[day_count].price_count = 1;
            day_count++;
        }
    }
    fclose(file);

    if (day_count == 0) {
        printf("No trend data found.\n");
        return;
    }

    float global_min = 999999, global_max = -1;

    // Compute min and max per day
    for (int i = 0; i < day_count; i++) {
        float min_p = trends[i].prices[0];
        float max_p = trends[i].prices[0];
        for (int j = 1; j < trends[i].price_count; j++) {
            if (trends[i].prices[j] < min_p) min_p = trends[i].prices[j];
            if (trends[i].prices[j] > max_p) max_p = trends[i].prices[j];
        }
        trends[i].min_price = min_p;
        trends[i].max_price = max_p;

        if (min_p < global_min) global_min = min_p;
        if (max_p > global_max) global_max = max_p;
    }

    // Round to nearest 100
    int ymin = ((int)global_min / 100) * 100;
    int ymax = ((int)global_max / 100 + 1) * 100;

    // Print chart
    printf("\nStock Trend for: %s\n\n", stock_name);
    for (int y = ymax; y >= ymin; y -= 100) {
        printf("%5d | ", y);
        for (int i = 0; i < day_count; i++) {
            if ((int)trends[i].min_price <= y && (int)trends[i].max_price >= y)
                printf("|  ");  
            else
                printf("   ");  
        }
        printf("\n");
    }

    // X-axis line
    printf("       ");
    for (int i = 0; i < day_count; i++) printf("---");  
    printf("\n");

    // Print days with 2 spaces spacing
    printf("       ");
    for (int i = 0; i < day_count; i++) {
        printf("%2d  ", trends[i].day_only);
    }
    printf("\n");
}